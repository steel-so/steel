import type { Prisma, Site, SiteVersion } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { revalidateSites } from '@/src/lib/sites/cache'
import {
  createEmptySiteDocument,
  validateSiteDocument,
} from '@/src/lib/sites/document'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { keepStoredSearch } from '@/src/lib/sites/search/context'
import { siteSlugFromName, slugWithSuffix } from '@/src/lib/sites/slug'
import {
  buildSiteSnapshot,
  parseSiteSnapshot,
  type SiteSnapshot,
} from '@/src/lib/sites/snapshot'
import {
  toSiteDTO,
  toSiteSummaryDTO,
  toSiteVersionDTO,
} from '@/src/mappers/site.mapper'
import {
  type SiteDraftGlobalInput,
  type SiteDraftPageInput,
  SiteRepository,
} from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import {
  type CreateSiteDTO,
  DEFAULT_SITE_SETTINGS,
  type UpdateSiteDTO,
} from '@/src/schemas/site.schema'
import type { SiteDTO, SiteSummaryDTO, SiteVersionDTO } from '@/types/site'
import { assertSitesPermission, authorizeSite } from './site-access'
import { SiteExperimentService } from './site-experiment.service'
import { SiteIndexNowService } from './site-indexnow.service'

/** Abuse guard, far above any real workspace. */
export const MAX_SITES_PER_WORKSPACE = 100
/** Tries of `name`, `name-2`… before falling back to a random suffix. */
const SLUG_ATTEMPTS = 20

const json = (value: unknown) => value as Prisma.InputJsonValue

export function toPublicSiteDTO(site: Site): SiteDTO {
  return toSiteDTO(site, publicSiteUrl(site.slug))
}

/** First free slug derived from `base` (`clinica`, `clinica-2`…). */
export async function findFreeSiteSlug(base: string): Promise<Result<string>> {
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const candidate = slugWithSuffix(base, attempt)
    const taken = await SiteRepository.isSlugTaken(candidate)
    if (!taken.ok) return taken
    if (!taken.value) return ok(candidate)
  }
  return ok(slugWithSuffix(base, 1000 + Math.floor(Math.random() * 9_000_000)))
}

type InvalidDocument = { id: string; name: string; problems: string[] }

/** Every page and global must pass the catalog before going live. */
function validateDraft(snapshot: SiteSnapshot): InvalidDocument[] {
  const invalid: InvalidDocument[] = []
  for (const page of snapshot.pages) {
    const checked = validateSiteDocument(page.document)
    if (!checked.ok) {
      invalid.push({ id: page.id, name: page.title, problems: checked.error })
    }
  }
  for (const global of snapshot.globals) {
    const checked = validateSiteDocument(global.document)
    if (!checked.ok) {
      invalid.push({
        id: global.id,
        name: global.name,
        problems: checked.error,
      })
    }
  }
  return invalid
}

/** Current draft rows as a snapshot (publish). */
export async function snapshotDraft(site: Site): Promise<Result<SiteSnapshot>> {
  const [pages, globals] = await Promise.all([
    SitePageRepository.listWithDocuments(site.id),
    SiteGlobalRepository.listBySite(site.id),
  ])
  if (!pages.ok) return pages
  if (!globals.ok) return globals
  return ok(
    buildSiteSnapshot({
      name: site.name,
      theme: site.theme,
      settings: site.settings,
      homePageId: site.homePageId,
      pages: pages.value,
      globals: globals.value,
    }),
  )
}

/** Publishes a snapshot (shared with the landing page migration). */
export async function publishSnapshot(
  site: Site,
  snapshot: SiteSnapshot,
  actorId: string,
): Promise<Result<{ site: Site; version: SiteVersion }>> {
  if (snapshot.pages.length === 0) {
    return err(
      appError(
        'SITE_DOCUMENT_INVALID',
        'O site precisa de pelo menos uma página',
      ),
    )
  }
  const invalid = validateDraft(snapshot)
  if (invalid.length > 0) {
    return err(
      appError(
        'SITE_DOCUMENT_INVALID',
        'Corrija as páginas com problemas antes de publicar',
        invalid,
      ),
    )
  }
  const published = await SiteRepository.publish(
    site.id,
    json(snapshot),
    actorId,
  )
  if (!published.ok) return published
  revalidateSites(site.slug)
  return published
}

export const SiteService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SiteSummaryDTO[]>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const sites = await SiteRepository.listByWorkspace(workspaceId)
    if (!sites.ok) return sites
    return ok(
      sites.value.map((site) =>
        toSiteSummaryDTO(site, publicSiteUrl(site.slug)),
      ),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    return ok(toPublicSiteDTO(site.value))
  },

  /** Is `slug` free for a new site (or for `exceptSiteId` to take)? */
  async checkSlug(
    actorId: string,
    workspaceId: string,
    slug: string,
    exceptSiteId?: string,
  ): Promise<Result<{ slug: string; available: boolean }>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const taken = await SiteRepository.isSlugTaken(slug, exceptSiteId)
    if (!taken.ok) return taken
    return ok({ slug, available: !taken.value })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSiteDTO,
  ): Promise<Result<SiteDTO>> {
    const membership = await assertSitesPermission(
      actorId,
      workspaceId,
      'CREATE',
    )
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

    let slug = dto.slug
    if (!slug) {
      const free = await findFreeSiteSlug(siteSlugFromName(dto.name))
      if (!free.ok) return free
      slug = free.value
    }

    const created = await SiteRepository.createWithPages({
      site: {
        workspaceId,
        createdById: actorId,
        name: dto.name,
        slug,
        theme: json(dto.theme ?? {}),
        settings: json(dto.settings ?? DEFAULT_SITE_SETTINGS),
      },
      pages: [
        {
          parentId: null,
          title: 'Início',
          slug: 'inicio',
          path: 'inicio',
          position: 0,
          isHome: true,
          seo: {},
          document: json(createEmptySiteDocument()),
        },
      ],
      globals: [],
    })
    if (!created.ok) {
      auditMutation({
        entity: 'site',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    auditMutation({
      entity: 'site',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, slug },
    })
    return ok(toPublicSiteDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: UpdateSiteDTO,
  ): Promise<Result<SiteDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    if (dto.homePageId && dto.homePageId !== site.value.homePageId) {
      const page = await SitePageRepository.findById(dto.homePageId, siteId)
      if (!page.ok) return page
      const home = await SitePageRepository.setHome(siteId, dto.homePageId)
      if (!home.ok) return home
    }

    const updated = await SiteRepository.update(siteId, {
      name: dto.name,
      slug: dto.slug,
      theme: dto.theme === undefined ? undefined : json(dto.theme),
      // A settings save without the "Buscadores" block keeps the stored one.
      settings:
        dto.settings === undefined
          ? undefined
          : json(keepStoredSearch(dto.settings, site.value.settings)),
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    // A new slug moves the public address: drop what the old one cached.
    if (dto.slug && dto.slug !== site.value.slug) {
      revalidateSites(site.value.slug, dto.slug)
    }

    auditMutation({
      entity: 'site',
      action: 'update',
      actorId,
      targetId: siteId,
      meta: { fields: Object.keys(dto) },
    })
    return ok(toPublicSiteDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'DELETE')
    if (!site.ok) return site

    const removed = await SiteRepository.softDelete(siteId, site.value.slug)
    if (!removed.ok) return removed

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site',
      action: 'delete',
      actorId,
      targetId: siteId,
      meta: { slug: site.value.slug },
    })
    return ok(undefined)
  },

  async publish(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<{ site: SiteDTO; version: SiteVersionDTO }>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const snapshot = await snapshotDraft(site.value)
    if (!snapshot.ok) return snapshot

    const published = await publishSnapshot(site.value, snapshot.value, actorId)
    if (!published.ok) {
      auditMutation({
        entity: 'site',
        action: 'publish',
        actorId,
        targetId: siteId,
        outcome: 'failure',
        reason: published.error.code,
      })
      return published
    }

    // A/B tests whose variants this publish changed start a new run.
    const synced = await SiteExperimentService.syncWithPublication(
      siteId,
      snapshot.value,
    )
    if (!synced.ok) {
      logger.warn('sites.experiment.sync_failed', {
        siteId,
        code: synced.error.code,
      })
    }

    auditMutation({
      entity: 'site',
      action: 'publish',
      actorId,
      targetId: siteId,
      meta: { version: published.value.version.number },
    })
    // IndexNow (when the site turned it on); best effort, never blocks.
    void SiteIndexNowService.ping(published.value.site.slug, snapshot.value)
    return ok({
      site: toPublicSiteDTO(published.value.site),
      version: toSiteVersionDTO(
        published.value.version,
        published.value.version.id,
      ),
    })
  },

  async unpublish(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const updated = await SiteRepository.unpublish(siteId, actorId)
    if (!updated.ok) return updated

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site',
      action: 'unpublish',
      actorId,
      targetId: siteId,
    })
    return ok(toPublicSiteDTO(updated.value))
  },

  async listVersions(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteVersionDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const versions = await SiteRepository.listVersions(siteId)
    if (!versions.ok) return versions
    return ok(
      versions.value.map((version) =>
        toSiteVersionDTO(version, site.value.publishedVersionId),
      ),
    )
  },

  /** Copies a published version back into the draft. The live site does
   * not change until the next publish. */
  async restoreVersion(
    actorId: string,
    workspaceId: string,
    siteId: string,
    versionId: string,
  ): Promise<Result<SiteDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const version = await SiteRepository.findVersion(siteId, versionId)
    if (!version.ok) return version

    const snapshot = parseSiteSnapshot(version.value.snapshot)
    if (!snapshot.ok) {
      return err(
        appError(
          'SITE_DOCUMENT_INVALID',
          'Esta versão não pode ser restaurada',
        ),
      )
    }

    const pages: SiteDraftPageInput[] = snapshot.value.pages.map((page) => ({
      id: page.id,
      parentId: page.parentId,
      title: page.title,
      slug: page.slug,
      path: page.path,
      position: page.position,
      isHome: page.isHome,
      seo: json(page.seo),
      document: json(page.document),
    }))
    const globals: SiteDraftGlobalInput[] = snapshot.value.globals.map(
      (global) => ({
        id: global.id,
        kind: global.kind,
        name: global.name,
        document: json(global.document),
      }),
    )

    const restored = await SiteRepository.replaceDraft(siteId, {
      theme: json(snapshot.value.theme),
      settings: json(snapshot.value.settings),
      homePageId: snapshot.value.homePageId,
      pages,
      globals,
      updatedById: actorId,
    })
    if (!restored.ok) return restored

    auditMutation({
      entity: 'site',
      action: 'restore',
      actorId,
      targetId: siteId,
      meta: { versionId, version: version.value.number },
    })
    return ok(toPublicSiteDTO(restored.value))
  },
}
