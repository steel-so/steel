import type { BioLink, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { revalidateBioLinks } from '@/src/lib/bio-link/cache'
import { bioSlugFromName, bioSlugWithSuffix } from '@/src/lib/bio-link/slug'
import { bioLinkPublicUrl } from '@/src/lib/bio-link/url'
import { bioBlockTitle } from '@/src/lib/bio-link/visibility'
import { err, ok, type Result } from '@/src/lib/result'
import { ratio, resolveAnalyticsRange } from '@/src/lib/sites/analytics'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import {
  toBioLinkDTO,
  toBioLinkSummaryDTO,
} from '@/src/mappers/bio-link.mapper'
import {
  BioLinkEventRepository,
  BioLinkLookupRepository,
  BioLinkRepository,
  type BioLinkWindow,
} from '@/src/repositories/bio-link.repository'
import {
  type BioAnalyticsQueryDTO,
  type BioBlockDTO,
  type CreateBioLinkDTO,
  DEFAULT_BIO_THEME,
  parseBioBlocks,
  type UpdateBioLinkDTO,
} from '@/src/schemas/bio-link.schema'
import type {
  BioLinkAnalyticsDTO,
  BioLinkDTO,
  BioLinkOptionsDTO,
  BioLinkSummaryDTO,
} from '@/types/bio-link'
import { assertModuleMember } from './authz'

/**
 * "Link da bio" lives in the CRM module (menu Atrair) and reuses the
 * `landing-pages` permission, like Sites: a profile that could build a site
 * can build a bio page (Membro creates and edits, Visualizador only views,
 * deleting needs DELETE).
 */
export const BIO_LINK_RESOURCE = 'landing-pages'

/** Abuse guard, far above any real workspace (no plan limit applies). */
export const MAX_BIO_LINKS_PER_WORKSPACE = 50
/** Tries of `name`, `name-2`… before falling back to a random suffix. */
const SLUG_ATTEMPTS = 20
/** Metrics are counted in the same timezone as the sites'. */
export const BIO_TIMEZONE = 'America/Sao_Paulo'

type Action = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE'

function assertPermission(
  actorId: string,
  workspaceId: string,
  action: Action,
) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: BIO_LINK_RESOURCE,
    action,
  })
}

const json = (value: unknown) => value as Prisma.InputJsonValue

async function authorize(
  actorId: string,
  workspaceId: string,
  bioLinkId: string,
  action: Action,
): Promise<Result<BioLink>> {
  const membership = await assertPermission(actorId, workspaceId, action)
  if (!membership.ok) return membership
  return BioLinkRepository.findById(bioLinkId, workspaceId)
}

async function findFreeSlug(base: string): Promise<Result<string>> {
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const candidate = bioSlugWithSuffix(base, attempt)
    const taken = await BioLinkRepository.isSlugTaken(candidate)
    if (!taken.ok) return taken
    if (!taken.value) return ok(candidate)
  }
  return ok(bioSlugWithSuffix(base, 1000 + Math.floor(Math.random() * 90_000)))
}

/** Every CRM form block must point at a form published in the workspace. */
async function assertFormsBelong(
  workspaceId: string,
  blocks: BioBlockDTO[],
): Promise<Result<true>> {
  const tokens = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'form') tokens.add(block.formToken)
  }
  if (tokens.size === 0) return ok(true)
  const forms = await BioLinkLookupRepository.publishedForms(workspaceId)
  if (!forms.ok) return forms
  const known = new Set(forms.value.map((form) => form.publicToken))
  const missing = [...tokens].find((token) => !known.has(token))
  if (missing) {
    return err(
      appError(
        'BIO_LINK_FORM_INVALID',
        'Um dos formulários escolhidos não está publicado neste workspace',
      ),
    )
  }
  return ok(true)
}

export const BioLinkService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<BioLinkSummaryDTO[]>> {
    const membership = await assertPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const rows = await BioLinkRepository.listByWorkspace(workspaceId)
    if (!rows.ok) return rows
    const totals = await BioLinkEventRepository.totalsFor(
      rows.value.map((row) => row.id),
    )
    if (!totals.ok) return totals
    return ok(
      rows.value.map((row) =>
        toBioLinkSummaryDTO(
          row,
          bioLinkPublicUrl(row.slug),
          totals.value.get(row.id) ?? { views: 0, clicks: 0 },
        ),
      ),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    bioLinkId: string,
  ): Promise<Result<BioLinkDTO>> {
    const row = await authorize(actorId, workspaceId, bioLinkId, 'VIEW')
    if (!row.ok) return row
    return ok(toBioLinkDTO(row.value, bioLinkPublicUrl(row.value.slug)))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateBioLinkDTO,
  ): Promise<Result<BioLinkDTO>> {
    const membership = await assertPermission(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    const count = await BioLinkRepository.countByWorkspace(workspaceId)
    if (!count.ok) return count
    if (count.value >= MAX_BIO_LINKS_PER_WORKSPACE) {
      return err(
        appError(
          'BIO_LINK_LIMIT_REACHED',
          `Este workspace já tem ${MAX_BIO_LINKS_PER_WORKSPACE} páginas de link da bio`,
        ),
      )
    }

    let slug = dto.slug
    if (slug) {
      const taken = await BioLinkRepository.isSlugTaken(slug)
      if (!taken.ok) return taken
      if (taken.value) {
        return err(
          appError('BIO_LINK_SLUG_TAKEN', 'Este endereço já está em uso'),
        )
      }
    } else {
      const free = await findFreeSlug(bioSlugFromName(dto.name))
      if (!free.ok) return free
      slug = free.value
    }

    const created = await BioLinkRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      slug,
      title: dto.name,
      theme: json(DEFAULT_BIO_THEME),
      blocks: json([]),
    })
    if (!created.ok) {
      auditMutation({
        entity: 'bio_link',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    auditMutation({
      entity: 'bio_link',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, slug },
    })
    return ok(toBioLinkDTO(created.value, bioLinkPublicUrl(slug)))
  },

  async update(
    actorId: string,
    workspaceId: string,
    bioLinkId: string,
    dto: UpdateBioLinkDTO,
  ): Promise<Result<BioLinkDTO>> {
    const current = await authorize(actorId, workspaceId, bioLinkId, 'EDIT')
    if (!current.ok) return current

    if (dto.slug !== undefined && dto.slug !== current.value.slug) {
      const taken = await BioLinkRepository.isSlugTaken(dto.slug, bioLinkId)
      if (!taken.ok) return taken
      if (taken.value) {
        return err(
          appError('BIO_LINK_SLUG_TAKEN', 'Este endereço já está em uso'),
        )
      }
    }
    if (dto.blocks) {
      const forms = await assertFormsBelong(workspaceId, dto.blocks)
      if (!forms.ok) return forms
    }

    const data: Prisma.BioLinkUncheckedUpdateInput = { updatedById: actorId }
    if (dto.name !== undefined) data.name = dto.name
    if (dto.slug !== undefined) data.slug = dto.slug
    if (dto.title !== undefined) data.title = dto.title || null
    if (dto.description !== undefined) {
      data.description = dto.description || null
    }
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl
    if (dto.theme !== undefined) data.theme = json(dto.theme)
    if (dto.blocks !== undefined) data.blocks = json(dto.blocks)
    if (dto.noIndex !== undefined) data.noIndex = dto.noIndex
    if (dto.status !== undefined && dto.status !== current.value.status) {
      data.status = dto.status
      data.publishedAt = dto.status === 'PUBLISHED' ? new Date() : null
    }

    const updated = await BioLinkRepository.update(bioLinkId, workspaceId, data)
    if (!updated.ok) {
      auditMutation({
        entity: 'bio_link',
        action: 'update',
        actorId,
        targetId: bioLinkId,
        outcome: 'failure',
        reason: updated.error.code,
      })
      return updated
    }

    revalidateBioLinks(current.value.slug, updated.value.slug)
    auditMutation({
      entity: 'bio_link',
      action: 'update',
      actorId,
      targetId: bioLinkId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toBioLinkDTO(updated.value, bioLinkPublicUrl(updated.value.slug)))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    bioLinkId: string,
  ): Promise<Result<null>> {
    const current = await authorize(actorId, workspaceId, bioLinkId, 'DELETE')
    if (!current.ok) return current

    const removed = await BioLinkRepository.remove(bioLinkId, workspaceId)
    if (!removed.ok) return removed
    revalidateBioLinks(current.value.slug)
    auditMutation({
      entity: 'bio_link',
      action: 'delete',
      actorId,
      targetId: bioLinkId,
      meta: { workspaceId, slug: current.value.slug },
    })
    return ok(null)
  },

  async slugAvailability(
    actorId: string,
    workspaceId: string,
    slug: string,
    bioLinkId?: string,
  ): Promise<Result<{ slug: string; available: boolean }>> {
    const membership = await assertPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const taken = await BioLinkRepository.isSlugTaken(slug, bioLinkId)
    if (!taken.ok) return taken
    return ok({ slug, available: !taken.value })
  },

  /** Lines, published sites and published forms for the ready-made buttons. */
  async options(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<BioLinkOptionsDTO>> {
    const membership = await assertPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const [lines, sites, forms] = await Promise.all([
      BioLinkLookupRepository.whatsappLines(workspaceId),
      BioLinkLookupRepository.publishedSites(workspaceId),
      BioLinkLookupRepository.publishedForms(workspaceId),
    ])
    if (!lines.ok) return lines
    if (!sites.ok) return sites
    if (!forms.ok) return forms
    return ok({
      whatsapp: lines.value,
      sites: sites.value.map((site) => ({
        id: site.id,
        name: site.name,
        url: publicSiteUrl(site.slug),
      })),
      forms: forms.value,
    })
  },

  async analytics(
    actorId: string,
    workspaceId: string,
    bioLinkId: string,
    query: BioAnalyticsQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<BioLinkAnalyticsDTO>> {
    const row = await authorize(actorId, workspaceId, bioLinkId, 'VIEW')
    if (!row.ok) return row

    const range = resolveAnalyticsRange({}, BIO_TIMEZONE, now, query.days)
    const window: BioLinkWindow = {
      bioLinkId,
      start: range.start,
      end: range.end,
      timezone: BIO_TIMEZONE,
    }

    const [daily, visitors, clicks, referrers, sources, countries, devices] =
      await Promise.all([
        BioLinkEventRepository.daily(window),
        BioLinkEventRepository.visitors(window),
        BioLinkEventRepository.clicksByLink(window),
        BioLinkEventRepository.breakdown(window, 'referrer'),
        BioLinkEventRepository.breakdown(window, 'utmSource'),
        BioLinkEventRepository.breakdown(window, 'country'),
        BioLinkEventRepository.breakdown(window, 'device'),
      ])
    if (!daily.ok) return daily
    if (!visitors.ok) return visitors
    if (!clicks.ok) return clicks
    if (!referrers.ok) return referrers
    if (!sources.ok) return sources
    if (!countries.ok) return countries
    if (!devices.ok) return devices

    const byDay = new Map<string, { views: number; clicks: number }>()
    for (const day of range.days) byDay.set(day, { views: 0, clicks: 0 })
    for (const entry of daily.value) {
      const slot = byDay.get(entry.day)
      if (!slot) continue
      if (entry.kind === 'VIEW') slot.views += entry.count
      else slot.clicks += entry.count
    }
    const series = range.days.map((day) => ({
      day,
      ...(byDay.get(day) ?? { views: 0, clicks: 0 }),
    }))
    const views = series.reduce((sum, item) => sum + item.views, 0)
    const totalClicks = series.reduce((sum, item) => sum + item.clicks, 0)

    const blocks = parseBioBlocks(row.value.blocks)
    const titles = new Map(
      blocks
        .filter((block) => block.type === 'link' || block.type === 'form')
        .map((block): [string, string] => [block.id, bioBlockTitle(block)]),
    )
    return ok({
      bioLinkId,
      timezone: BIO_TIMEZONE,
      from: range.from,
      to: range.to,
      totals: {
        views,
        visitors: visitors.value,
        clicks: totalClicks,
        clickRate: ratio(totalClicks, views),
      },
      daily: series,
      links: [
        ...clicks.value.map((click) => ({
          linkId: click.linkId,
          title: titles.get(click.linkId) ?? click.linkTitle ?? 'Link removido',
          clicks: click.count,
          exists: titles.has(click.linkId),
        })),
        // Buttons nobody clicked in the period still show, with zero.
        ...[...titles]
          .filter(([id]) => !clicks.value.some((click) => click.linkId === id))
          .map(([id, title]) => ({
            linkId: id,
            title,
            clicks: 0,
            exists: true,
          })),
      ],
      referrers: referrers.value,
      sources: sources.value,
      countries: countries.value,
      devices: devices.value,
    })
  },
}
