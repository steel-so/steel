import type {
  CrmForm,
  CrmLandingPage,
  CrmLandingPageSection,
  Prisma,
  Site,
  SiteGlobalKind,
  SiteVersion,
} from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type SiteWithPageCount = Site & { _count: { pages: number } }

export type SitePublished = Site & {
  publishedVersion: Pick<SiteVersion, 'id' | 'snapshot' | 'createdAt'>
}

export type SiteVersionSummary = Pick<
  SiteVersion,
  'id' | 'siteId' | 'number' | 'publishedById' | 'createdAt'
> & { publishedBy: { name: string } | null }

/** Rows of a draft restored from (or created alongside) a site. */
export interface SiteDraftPageInput {
  id?: string
  parentId: string | null
  title: string
  slug: string
  path: string
  position: number
  isHome: boolean
  seo: Prisma.InputJsonValue
  document: Prisma.InputJsonValue
}

export interface SiteDraftGlobalInput {
  id?: string
  kind: SiteGlobalKind
  name: string
  document: Prisma.InputJsonValue
}

export type LandingPageForMigration = CrmLandingPage & {
  sections: CrmLandingPageSection[]
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

const slugTaken = () =>
  appError('SITE_SLUG_TAKEN', 'Este endereço já está em uso por outro site')

/** Parents before children, so a multi-row insert never points forward. */
function byDepth(pages: SiteDraftPageInput[]): SiteDraftPageInput[] {
  return [...pages].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length,
  )
}

export const SiteRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<SiteWithPageCount[]>> {
    try {
      const sites = await prisma.site.findMany({
        where: { workspaceId, deletedAt: null },
        include: { _count: { select: { pages: true } } },
        orderBy: { updatedAt: 'desc' },
      })
      return ok(sites)
    } catch (error) {
      return err(dbError('Failed to list sites', error))
    }
  },

  async countByWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.site.count({ where: { workspaceId, deletedAt: null } }),
      )
    } catch (error) {
      return err(dbError('Failed to count sites', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<Site>> {
    try {
      const site = await prisma.site.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!site) return err(appError('SITE_NOT_FOUND', 'Site não encontrado'))
      return ok(site)
    } catch (error) {
      return err(dbError('Failed to find site by id', error))
    }
  },

  /** Is `slug` used by any site (deleted ones free their slug)? */
  async isSlugTaken(slug: string, exceptId?: string): Promise<Result<boolean>> {
    try {
      const site = await prisma.site.findUnique({
        where: { slug },
        select: { id: true },
      })
      return ok(Boolean(site && site.id !== exceptId))
    } catch (error) {
      return err(dbError('Failed to check site slug', error))
    }
  },

  async findBySourceLandingPageId(
    landingPageId: string,
  ): Promise<Result<Site | null>> {
    try {
      const site = await prisma.site.findFirst({
        where: { sourceLandingPageId: landingPageId },
      })
      return ok(site)
    } catch (error) {
      return err(dbError('Failed to find site by landing page', error))
    }
  },

  /** Creates the site with its first (home) page and optional globals. */
  async createWithPages(data: {
    site: {
      workspaceId: string
      createdById: string
      name: string
      slug: string
      theme: Prisma.InputJsonValue
      settings: Prisma.InputJsonValue
      sourceLandingPageId?: string
    }
    pages: SiteDraftPageInput[]
    globals: SiteDraftGlobalInput[]
  }): Promise<Result<Site>> {
    try {
      const site = await prisma.$transaction(async (tx) => {
        const created = await tx.site.create({ data: data.site })
        let homePageId: string | null = null
        for (const page of byDepth(data.pages)) {
          const row = await tx.sitePage.create({
            data: { ...page, siteId: created.id },
            select: { id: true, isHome: true },
          })
          if (row.isHome) homePageId = row.id
        }
        if (data.globals.length > 0) {
          await tx.siteGlobal.createMany({
            data: data.globals.map((global) => ({
              ...global,
              siteId: created.id,
            })),
          })
        }
        return tx.site.update({
          where: { id: created.id },
          data: { homePageId },
        })
      })
      return ok(site)
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken())
      return err(dbError('Failed to create site', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      slug?: string
      theme?: Prisma.InputJsonValue
      settings?: Prisma.InputJsonValue
      updatedById: string
    },
  ): Promise<Result<Site>> {
    try {
      return ok(await prisma.site.update({ where: { id }, data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(slugTaken())
      return err(dbError('Failed to update site', error))
    }
  },

  /** Soft delete that also frees the slug (the subdomain) and takes the
   * site offline. */
  async softDelete(id: string, slug: string): Promise<Result<void>> {
    try {
      await prisma.site.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          slug: `${slug}.deleted.${id}`,
          status: 'DRAFT',
          publishedVersionId: null,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site', error))
    }
  },

  /** The live site behind a public slug, with its published snapshot. */
  async findPublishedBySlug(slug: string): Promise<Result<SitePublished>> {
    try {
      const site = await prisma.site.findFirst({
        where: { slug, deletedAt: null, status: 'PUBLISHED' },
        include: {
          publishedVersion: {
            select: { id: true, snapshot: true, createdAt: true },
          },
        },
      })
      if (!site?.publishedVersion) {
        return err(appError('SITE_NOT_FOUND', 'Site não encontrado'))
      }
      return ok(site as SitePublished)
    } catch (error) {
      return err(dbError('Failed to find published site', error))
    }
  },

  /** Snapshots the draft into a new numbered version and makes it live. */
  async publish(
    siteId: string,
    snapshot: Prisma.InputJsonValue,
    publishedById: string,
  ): Promise<Result<{ site: Site; version: SiteVersion }>> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const last = await tx.siteVersion.findFirst({
          where: { siteId },
          orderBy: { number: 'desc' },
          select: { number: true },
        })
        const version = await tx.siteVersion.create({
          data: {
            siteId,
            number: (last?.number ?? 0) + 1,
            snapshot,
            publishedById,
          },
        })
        const site = await tx.site.update({
          where: { id: siteId },
          data: {
            status: 'PUBLISHED',
            publishedVersionId: version.id,
            publishedAt: version.createdAt,
            updatedById: publishedById,
          },
        })
        return { site, version }
      })
      return ok(result)
    } catch (error) {
      if (isUniqueViolation(error)) {
        return err(
          appError(
            'CONFLICT',
            'Outra publicação deste site está em andamento. Tente de novo.',
          ),
        )
      }
      return err(dbError('Failed to publish site', error))
    }
  },

  async unpublish(siteId: string, actorId: string): Promise<Result<Site>> {
    try {
      return ok(
        await prisma.site.update({
          where: { id: siteId },
          data: {
            status: 'DRAFT',
            publishedVersionId: null,
            updatedById: actorId,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to unpublish site', error))
    }
  },

  async listVersions(
    siteId: string,
    take = 50,
  ): Promise<Result<SiteVersionSummary[]>> {
    try {
      const versions = await prisma.siteVersion.findMany({
        where: { siteId },
        select: {
          id: true,
          siteId: true,
          number: true,
          publishedById: true,
          createdAt: true,
          publishedBy: { select: { name: true } },
        },
        orderBy: { number: 'desc' },
        take,
      })
      return ok(versions)
    } catch (error) {
      return err(dbError('Failed to list site versions', error))
    }
  },

  async findVersion(
    siteId: string,
    versionId: string,
  ): Promise<Result<SiteVersion>> {
    try {
      const version = await prisma.siteVersion.findFirst({
        where: { id: versionId, siteId },
      })
      if (!version) {
        return err(appError('SITE_VERSION_NOT_FOUND', 'Versão não encontrada'))
      }
      return ok(version)
    } catch (error) {
      return err(dbError('Failed to find site version', error))
    }
  },

  /** Replaces the draft (pages, globals, theme, settings) with a snapshot.
   * The live version is untouched until the next publish. */
  async replaceDraft(
    siteId: string,
    data: {
      theme: Prisma.InputJsonValue
      settings: Prisma.InputJsonValue
      homePageId: string | null
      pages: SiteDraftPageInput[]
      globals: SiteDraftGlobalInput[]
      updatedById: string
    },
  ): Promise<Result<Site>> {
    try {
      const site = await prisma.$transaction(async (tx) => {
        await tx.sitePage.deleteMany({ where: { siteId } })
        await tx.siteGlobal.deleteMany({ where: { siteId } })
        await tx.sitePage.createMany({
          data: byDepth(data.pages).map((page) => ({ ...page, siteId })),
        })
        if (data.globals.length > 0) {
          await tx.siteGlobal.createMany({
            data: data.globals.map((global) => ({ ...global, siteId })),
          })
        }
        return tx.site.update({
          where: { id: siteId },
          data: {
            theme: data.theme,
            settings: data.settings,
            homePageId: data.homePageId,
            updatedById: data.updatedById,
          },
        })
      })
      return ok(site)
    } catch (error) {
      return err(dbError('Failed to restore site draft', error))
    }
  },

  /** Published CRM forms of the workspace among `tokens` (site.form
   * blocks point to a form by its public token). */
  async findPublishedForms(
    workspaceId: string,
    tokens: string[],
  ): Promise<Result<CrmForm[]>> {
    if (tokens.length === 0) return ok([])
    try {
      const forms = await prisma.crmForm.findMany({
        where: {
          publicToken: { in: tokens },
          workspaceId,
          status: 'PUBLISHED',
          deletedAt: null,
        },
      })
      return ok(forms)
    } catch (error) {
      return err(dbError('Failed to load site forms', error))
    }
  },

  /** Token and name of workspace forms by id (landing page migration). */
  async findFormsByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<Array<Pick<CrmForm, 'id' | 'name' | 'publicToken'>>>> {
    if (ids.length === 0) return ok([])
    try {
      const forms = await prisma.crmForm.findMany({
        where: { id: { in: ids }, workspaceId, deletedAt: null },
        select: { id: true, name: true, publicToken: true },
      })
      return ok(forms)
    } catch (error) {
      return err(dbError('Failed to load forms by id', error))
    }
  },

  async recordView(data: {
    siteId: string
    pageId: string | null
    path: string
    visitorHash: string
    referrer: string | null
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    utmTerm?: string
    utmContent?: string
  }): Promise<Result<void>> {
    try {
      await prisma.siteView.create({ data })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record site view', error))
    }
  },

  /** Slug of the published site migrated from the landing page behind
   * `shareToken`, if any (`/l/<token>` redirects there). */
  async findPublishedSlugByLandingShareToken(
    shareToken: string,
  ): Promise<Result<string | null>> {
    try {
      const landing = await prisma.crmLandingPage.findFirst({
        where: { shareToken, deletedAt: null },
        select: { id: true },
      })
      if (!landing) return ok(null)
      const site = await prisma.site.findFirst({
        where: {
          sourceLandingPageId: landing.id,
          status: 'PUBLISHED',
          deletedAt: null,
        },
        select: { slug: true },
      })
      return ok(site?.slug ?? null)
    } catch (error) {
      return err(dbError('Failed to resolve migrated landing page', error))
    }
  },

  /** Landing pages (with sections) still to be looked at by the migration. */
  async listLandingPagesForMigration(
    workspaceId?: string,
  ): Promise<Result<LandingPageForMigration[]>> {
    try {
      const pages = await prisma.crmLandingPage.findMany({
        where: { deletedAt: null, ...(workspaceId ? { workspaceId } : {}) },
        include: { sections: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      })
      return ok(pages)
    } catch (error) {
      return err(dbError('Failed to list landing pages to migrate', error))
    }
  },
}
