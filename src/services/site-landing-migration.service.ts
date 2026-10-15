import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { ok, type Result } from '@/src/lib/result'
import { convertLandingPage } from '@/src/lib/sites/landing-converter'
import { siteSlugFromName } from '@/src/lib/sites/slug'
import {
  type LandingPageForMigration,
  type SiteDraftGlobalInput,
  SiteRepository,
} from '@/src/repositories/site.repository'
import { DEFAULT_SITE_SETTINGS } from '@/src/schemas/site.schema'
import type { SiteLandingMigrationDTO } from '@/types/site'
import { assertModulePrivileged } from './authz'
import {
  findFreeSiteSlug,
  publishSnapshot,
  snapshotDraft,
} from './site.service'

const json = (value: unknown) => value as Prisma.InputJsonValue

/** The converter keeps the landing page's form id; `site.form` points to a
 * form by its public token (and shows its name in the editor). A form that
 * no longer exists leaves the block empty. */
async function linkForms(
  doc: CanvasDocument,
  workspaceId: string,
): Promise<Result<CanvasDocument>> {
  const blocks = Object.values(doc.nodes).filter(
    (node) =>
      node.type === 'site.form' && typeof node.props.formId === 'string',
  )
  if (blocks.length === 0) return ok(doc)
  const forms = await SiteRepository.findFormsByIds(
    workspaceId,
    blocks.map((node) => node.props.formId as string),
  )
  if (!forms.ok) return forms
  for (const node of blocks) {
    const form = forms.value.find((item) => item.id === node.props.formId)
    const { formId: _formId, ...props } = node.props
    node.props = {
      ...props,
      formToken: form?.publicToken ?? '',
      formName: form?.name ?? '',
    }
  }
  return ok(doc)
}

export interface SiteLandingMigrationReport {
  created: number
  skipped: number
  failed: number
  items: SiteLandingMigrationDTO[]
}

/**
 * Landing page → site migration (sites wave S1). Each landing page becomes a
 * one-page site with its header/footer as globals; a published landing page
 * is published as version 1, so `/l/<token>` can redirect to it. Idempotent:
 * `Site.sourceLandingPageId` is unique and a landing page that already has a
 * site is skipped. The landing page itself is never changed.
 */
export const SiteLandingMigrationService = {
  async migrateLandingPage(
    landing: LandingPageForMigration,
  ): Promise<Result<SiteLandingMigrationDTO>> {
    const existing = await SiteRepository.findBySourceLandingPageId(landing.id)
    if (!existing.ok) return existing
    if (existing.value) {
      return ok({
        landingPageId: landing.id,
        siteId: existing.value.id,
        slug: existing.value.slug,
        status: 'skipped',
        published: existing.value.status === 'PUBLISHED',
      })
    }

    const converted = convertLandingPage(landing)
    const page = await linkForms(converted.page, landing.workspaceId)
    if (!page.ok) return page
    const slug = await findFreeSiteSlug(siteSlugFromName(landing.title))
    if (!slug.ok) return slug

    const globals: SiteDraftGlobalInput[] = []
    if (converted.header) {
      globals.push({
        kind: 'HEADER',
        name: 'Cabeçalho',
        document: json(converted.header),
      })
    }
    if (converted.footer) {
      globals.push({
        kind: 'FOOTER',
        name: 'Rodapé',
        document: json(converted.footer),
      })
    }

    const created = await SiteRepository.createWithPages({
      site: {
        workspaceId: landing.workspaceId,
        createdById: landing.createdById,
        name: landing.title,
        slug: slug.value,
        theme: {},
        settings: json(DEFAULT_SITE_SETTINGS),
        sourceLandingPageId: landing.id,
      },
      pages: [
        {
          parentId: null,
          title: landing.title,
          slug: 'inicio',
          path: 'inicio',
          position: 0,
          isHome: true,
          seo: {},
          document: json(page.value),
        },
      ],
      globals,
    })
    if (!created.ok) return created

    let published = false
    if (landing.status === 'PUBLISHED') {
      const snapshot = await snapshotDraft(created.value)
      const result = snapshot.ok
        ? await publishSnapshot(
            created.value,
            snapshot.value,
            landing.createdById,
          )
        : snapshot
      published = result.ok
      if (!result.ok) {
        // The site exists as a draft; publishing can be retried in the UI.
        logger.warn('sites.migration.publish_failed', {
          landingPageId: landing.id,
          siteId: created.value.id,
          code: result.error.code,
        })
      }
    }

    auditMutation({
      entity: 'site',
      action: 'migrate',
      actorId: null,
      targetId: created.value.id,
      meta: {
        landingPageId: landing.id,
        published,
        skippedSections: converted.skipped,
      },
    })
    return ok({
      landingPageId: landing.id,
      siteId: created.value.id,
      slug: created.value.slug,
      status: 'created',
      published,
    })
  },

  /** Migrates every landing page (of one workspace, or of all of them). A
   * failure on one page is reported and the run goes on. */
  async migrateAll(
    workspaceId?: string,
  ): Promise<Result<SiteLandingMigrationReport>> {
    const landings =
      await SiteRepository.listLandingPagesForMigration(workspaceId)
    if (!landings.ok) return landings

    const report: SiteLandingMigrationReport = {
      created: 0,
      skipped: 0,
      failed: 0,
      items: [],
    }
    for (const landing of landings.value) {
      const result =
        await SiteLandingMigrationService.migrateLandingPage(landing)
      if (!result.ok) {
        report.failed += 1
        logger.error('sites.migration.failed', {
          landingPageId: landing.id,
          code: result.error.code,
        })
        continue
      }
      if (result.value.status === 'created') report.created += 1
      else report.skipped += 1
      report.items.push(result.value)
    }
    return ok(report)
  },

  /** Workspace admins migrate their own landing pages from the UI. */
  async migrateWorkspace(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SiteLandingMigrationReport>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const report = await SiteLandingMigrationService.migrateAll(workspaceId)
    if (!report.ok) return report

    auditMutation({
      entity: 'site',
      action: 'migrate',
      actorId,
      targetId: workspaceId,
      meta: {
        created: report.value.created,
        skipped: report.value.skipped,
        failed: report.value.failed,
      },
    })
    return report
  },
}
