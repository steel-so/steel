import { createId } from '@paralleldrive/cuid2'
import type { Prisma, Site } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { diffSiteSnapshots, type SiteChangesDTO } from '@/src/lib/sites/changes'
import { siteSlugFromName } from '@/src/lib/sites/slug'
import { parseSiteSnapshot } from '@/src/lib/sites/snapshot'
import { buildSiteFromTemplate } from '@/src/lib/sites/templates'
import {
  type SiteDraftGlobalInput,
  type SiteDraftPageInput,
  SiteRepository,
} from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { DEFAULT_SITE_SETTINGS } from '@/src/schemas/site.schema'
import type {
  CreateSiteFromTemplateDTO,
  DuplicateSiteDTO,
} from '@/src/schemas/site-studio.schema'
import type { SiteDTO } from '@/types/site'
import {
  findFreeSiteSlug,
  MAX_SITES_PER_WORKSPACE,
  snapshotDraft,
  toPublicSiteDTO,
} from './site.service'
import { assertSitesPermission, authorizeSite } from './site-access'

/**
 * Site builder flows of the editor UI that span several rows at once: a
 * site from a full-page template, a copy of a site, and the summary of what
 * the next publish changes.
 */

const json = (value: unknown) => value as Prisma.InputJsonValue

/** CREATE permission and the per-workspace cap, shared by both creates. */
async function assertCanCreate(
  actorId: string,
  workspaceId: string,
): Promise<Result<void>> {
  const membership = await assertSitesPermission(actorId, workspaceId, 'CREATE')
  if (!membership.ok) return membership
  const count = await SiteRepository.countByWorkspace(workspaceId)
  if (!count.ok) return count
  if (count.value >= MAX_SITES_PER_WORKSPACE) {
    return err(
      appError(
        'SITE_LIMIT_REACHED',
        `Este workspace já tem ${MAX_SITES_PER_WORKSPACE} sites`,
      ),
    )
  }
  return ok(undefined)
}

async function createSite(
  actorId: string,
  workspaceId: string,
  input: {
    name: string
    slug: string
    theme: unknown
    settings: unknown
    pages: SiteDraftPageInput[]
    globals: SiteDraftGlobalInput[]
  },
  meta: Record<string, unknown>,
): Promise<Result<Site>> {
  const created = await SiteRepository.createWithPages({
    site: {
      workspaceId,
      createdById: actorId,
      name: input.name,
      slug: input.slug,
      theme: json(input.theme),
      settings: json(input.settings),
    },
    pages: input.pages,
    globals: input.globals,
  })
  if (!created.ok) {
    auditMutation({
      entity: 'site',
      action: 'create',
      actorId,
      outcome: 'failure',
      reason: created.error.code,
      meta,
    })
    return created
  }
  auditMutation({
    entity: 'site',
    action: 'create',
    actorId,
    targetId: created.value.id,
    meta: { workspaceId, slug: input.slug, ...meta },
  })
  return created
}

export const SiteStudioService = {
  /** A site whose home page, header and footer come from a template. */
  async createFromTemplate(
    actorId: string,
    workspaceId: string,
    dto: CreateSiteFromTemplateDTO,
  ): Promise<Result<SiteDTO>> {
    const allowed = await assertCanCreate(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const build = buildSiteFromTemplate(dto.templateId)
    if (!build) {
      return err(appError('VALIDATION_ERROR', 'Modelo desconhecido'))
    }

    let slug = dto.slug
    if (!slug) {
      const free = await findFreeSiteSlug(siteSlugFromName(dto.name))
      if (!free.ok) return free
      slug = free.value
    }

    const globals: SiteDraftGlobalInput[] = []
    if (build.header) {
      globals.push({
        kind: 'HEADER',
        name: 'Cabeçalho',
        document: json(build.header),
      })
    }
    if (build.footer) {
      globals.push({
        kind: 'FOOTER',
        name: 'Rodapé',
        document: json(build.footer),
      })
    }

    const created = await createSite(
      actorId,
      workspaceId,
      {
        name: dto.name,
        slug,
        theme: build.theme,
        settings: DEFAULT_SITE_SETTINGS,
        pages: [
          {
            parentId: null,
            title: 'Início',
            slug: 'inicio',
            path: 'inicio',
            position: 0,
            isHome: true,
            seo: {},
            document: json(build.home),
          },
        ],
        globals,
      },
      { templateId: dto.templateId },
    )
    if (!created.ok) return created
    return ok(toPublicSiteDTO(created.value))
  },

  /** A draft copy of a site: theme, settings, every page (same tree and
   * paths) and its globals. Never published, whatever the source is. */
  async duplicate(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: DuplicateSiteDTO,
  ): Promise<Result<SiteDTO>> {
    const source = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!source.ok) return source
    const allowed = await assertCanCreate(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const [pages, globals] = await Promise.all([
      SitePageRepository.listWithDocuments(siteId),
      SiteGlobalRepository.listBySite(siteId),
    ])
    if (!pages.ok) return pages
    if (!globals.ok) return globals

    const slug = await findFreeSiteSlug(`${source.value.slug}-copia`)
    if (!slug.ok) return slug

    // Fresh ids, with each parent pointing at its own copy.
    const ids = new Map(pages.value.map((page) => [page.id, createId()]))
    const homeId = source.value.homePageId
    const created = await createSite(
      actorId,
      workspaceId,
      {
        name: dto.name ?? `${source.value.name} (cópia)`,
        slug: slug.value,
        theme: source.value.theme,
        settings: source.value.settings,
        pages: pages.value.map((page) => ({
          id: ids.get(page.id),
          parentId: page.parentId ? (ids.get(page.parentId) ?? null) : null,
          title: page.title,
          slug: page.slug,
          path: page.path,
          position: page.position,
          isHome: homeId ? page.id === homeId : page.isHome,
          seo: json(page.seo ?? {}),
          document: json(page.document),
        })),
        globals: globals.value.map((global) => ({
          kind: global.kind,
          name: global.name,
          document: json(global.document),
        })),
      },
      { duplicatedFrom: siteId },
    )
    if (!created.ok) return created
    return ok(toPublicSiteDTO(created.value))
  },

  /** What publishing now would change on the live site. */
  async pendingChanges(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteChangesDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const draft = await snapshotDraft(site.value)
    if (!draft.ok) return draft

    const versionId = site.value.publishedVersionId
    if (!versionId) return ok(diffSiteSnapshots(null, draft.value))

    const version = await SiteRepository.findVersion(siteId, versionId)
    if (!version.ok) return version
    const live = parseSiteSnapshot(version.value.snapshot)
    // An unreadable live snapshot is replaced wholesale by the next publish.
    return ok(
      diffSiteSnapshots(
        live.ok ? live.value : null,
        draft.value,
        version.value.createdAt.toISOString(),
      ),
    )
  },
}
