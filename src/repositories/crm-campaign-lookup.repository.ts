import type {
  WhatsAppConnection,
  WhatsAppQuickReply,
  WhatsAppTemplate,
} from '@prisma/client'
import { EMAIL_CATALOG_ID } from '@/src/lib/canvas-email/catalog'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Read-only lookups of the records a campaign points to (landing pages,
 * forms, e-mail templates, mailing lists, WhatsApp connections/templates),
 * always scoped to the campaign's workspace.
 */

export interface CampaignDestinationRecord {
  id: string
  token: string
  published: boolean
  /** Landing page title or form name. */
  name?: string
}

/** A site as a campaign destination: its published snapshot (raw, parsed
 * by the service) and the ids of its draft pages. */
export interface CampaignSiteRecord {
  id: string
  name: string
  slug: string
  status: 'DRAFT' | 'PUBLISHED'
  updatedAt: Date
  /** `SiteVersion.snapshot` of the live publication; `null` when never
   * published or unpublished. */
  snapshot: unknown | null
  pages: { id: string; title: string; path: string; isHome: boolean }[]
}

const SITE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  updatedAt: true,
  publishedVersion: { select: { snapshot: true } },
  pages: {
    select: { id: true, title: true, path: true, isHome: true },
    orderBy: { position: 'asc' as const },
  },
}

type SiteRow = {
  id: string
  name: string
  slug: string
  status: 'DRAFT' | 'PUBLISHED'
  updatedAt: Date
  publishedVersion: { snapshot: unknown } | null
  pages: { id: string; title: string; path: string; isHome: boolean }[]
}

function toSiteRecord(site: SiteRow): CampaignSiteRecord {
  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    status: site.status,
    updatedAt: site.updatedAt,
    snapshot:
      site.status === 'PUBLISHED'
        ? (site.publishedVersion?.snapshot ?? null)
        : null,
    pages: site.pages,
  }
}

/** Sites listed by the destination picker (newest first). */
const MAX_PICKER_SITES = 100

export const CrmCampaignLookupRepository = {
  async findSite(
    workspaceId: string,
    id: string,
  ): Promise<Result<CampaignSiteRecord | null>> {
    try {
      const site = await prisma.site.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: SITE_SELECT,
      })
      return ok(site ? toSiteRecord(site) : null)
    } catch (error) {
      return err(dbError('Failed to find campaign site', error))
    }
  },

  /** Sites of many campaigns at once (list view links). */
  async findSites(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<CampaignSiteRecord[]>> {
    if (ids.length === 0) return ok([])
    try {
      const sites = await prisma.site.findMany({
        where: { id: { in: ids }, workspaceId, deletedAt: null },
        select: SITE_SELECT,
      })
      return ok(sites.map(toSiteRecord))
    } catch (error) {
      return err(dbError('Failed to find campaign sites', error))
    }
  },

  /** Live site of the workspace by its public slug (form attribution). */
  async findSiteIdBySlug(
    workspaceId: string,
    slug: string,
  ): Promise<Result<string | null>> {
    try {
      const site = await prisma.site.findFirst({
        where: { slug, workspaceId, deletedAt: null },
        select: { id: true },
      })
      return ok(site?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find campaign site by slug', error))
    }
  },

  async findQuickReply(
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppQuickReply | null>> {
    try {
      const reply = await prisma.whatsAppQuickReply.findFirst({
        where: { id, workspaceId },
      })
      return ok(reply)
    } catch (error) {
      return err(dbError('Failed to find campaign quick reply', error))
    }
  },

  async findLandingPage(
    workspaceId: string,
    id: string,
  ): Promise<Result<CampaignDestinationRecord | null>> {
    try {
      const page = await prisma.crmLandingPage.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, shareToken: true, status: true, title: true },
      })
      return ok(
        page
          ? {
              id: page.id,
              token: page.shareToken,
              published: page.status === 'PUBLISHED',
              name: page.title,
            }
          : null,
      )
    } catch (error) {
      return err(dbError('Failed to find campaign landing page', error))
    }
  },

  async findForm(
    workspaceId: string,
    id: string,
  ): Promise<Result<CampaignDestinationRecord | null>> {
    try {
      const form = await prisma.crmForm.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, publicToken: true, status: true, name: true },
      })
      return ok(
        form
          ? {
              id: form.id,
              token: form.publicToken,
              published: form.status === 'PUBLISHED',
              name: form.name,
            }
          : null,
      )
    } catch (error) {
      return err(dbError('Failed to find campaign form', error))
    }
  },

  async findEmailTemplate(
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string; subject: string } | null>> {
    try {
      const template = await prisma.crmEmailTemplate.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, subject: true },
      })
      return ok(template)
    } catch (error) {
      return err(dbError('Failed to find campaign e-mail template', error))
    }
  },

  /** Subject and stored document of a template (pre-send checklist). */
  async findEmailTemplateContent(
    workspaceId: string,
    id: string,
  ): Promise<
    Result<{
      id: string
      subject: string
      kind: 'LEGACY' | 'BUILDER'
      builderDocument: unknown
    } | null>
  > {
    try {
      const template = await prisma.crmEmailTemplate.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, subject: true, kind: true, builderDocument: true },
      })
      return ok(template)
    } catch (error) {
      return err(dbError('Failed to read campaign e-mail template', error))
    }
  },

  /** Comunicação connection (module COMMUNICATION) of the workspace. */
  async findConnection(
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id, workspaceId, module: 'COMMUNICATION' },
      })
      return ok(connection)
    } catch (error) {
      return err(dbError('Failed to find campaign WhatsApp connection', error))
    }
  },

  async findWhatsAppTemplate(
    workspaceId: string,
    connectionId: string,
    id: string,
  ): Promise<Result<WhatsAppTemplate | null>> {
    try {
      const template = await prisma.whatsAppTemplate.findFirst({
        where: { id, workspaceId, connectionId },
      })
      return ok(template)
    } catch (error) {
      return err(dbError('Failed to find campaign WhatsApp template', error))
    }
  },

  /** Destination tokens of many campaigns at once (list view links). */
  async destinationTokens(
    workspaceId: string,
    ids: { landingPageIds: string[]; formIds: string[] },
  ): Promise<Result<Map<string, string>>> {
    try {
      const [pages, forms] = await Promise.all([
        ids.landingPageIds.length
          ? prisma.crmLandingPage.findMany({
              where: { workspaceId, id: { in: ids.landingPageIds } },
              select: { id: true, shareToken: true },
            })
          : [],
        ids.formIds.length
          ? prisma.crmForm.findMany({
              where: { workspaceId, id: { in: ids.formIds } },
              select: { id: true, publicToken: true },
            })
          : [],
      ])
      const map = new Map<string, string>()
      for (const page of pages) map.set(page.id, page.shareToken)
      for (const form of forms) map.set(form.id, form.publicToken)
      return ok(map)
    } catch (error) {
      return err(dbError('Failed to read campaign destinations', error))
    }
  },

  /** Everything the wizard pickers list, in one round trip. */
  async listOptions(workspaceId: string): Promise<
    Result<{
      landingPages: {
        id: string
        title: string
        status: string
        shareToken: string
        /** Site this landing page was migrated into, if any. */
        migratedSiteId: string | null
      }[]
      forms: { id: string; name: string; status: string; publicToken: string }[]
      emailTemplates: {
        id: string
        name: string
        subject: string
        kind: 'LEGACY' | 'BUILDER'
        /** Steel Canvas (v2) document. */
        canvas: boolean
        updatedAt: Date
      }[]
      mailingLists: { id: string; name: string }[]
      connections: (WhatsAppConnection & { templates: WhatsAppTemplate[] })[]
      sites: CampaignSiteRecord[]
      quickReplies: WhatsAppQuickReply[]
    }>
  > {
    try {
      const [
        landingPages,
        forms,
        emailTemplates,
        canvasTemplates,
        mailingLists,
        connections,
        sites,
        migrated,
        quickReplies,
      ] = await Promise.all([
        prisma.crmLandingPage.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true, title: true, status: true, shareToken: true },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.crmForm.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true, name: true, status: true, publicToken: true },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.crmEmailTemplate.findMany({
          where: { workspaceId, deletedAt: null },
          select: {
            id: true,
            name: true,
            subject: true,
            kind: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.crmEmailTemplate.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            kind: 'BUILDER',
            builderDocument: { path: ['catalog'], equals: EMAIL_CATALOG_ID },
          },
          select: { id: true },
        }),
        prisma.crmMailingList.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.whatsAppConnection.findMany({
          where: {
            workspaceId,
            module: 'COMMUNICATION',
            status: 'CONNECTED',
          },
          include: {
            templates: {
              // Paused/disabled ones are listed (blocked, with the reason).
              where: { status: { in: ['APPROVED', 'PAUSED', 'DISABLED'] } },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.site.findMany({
          where: { workspaceId, deletedAt: null },
          select: SITE_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: MAX_PICKER_SITES,
        }),
        prisma.site.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            sourceLandingPageId: { not: null },
          },
          select: { id: true, sourceLandingPageId: true },
        }),
        prisma.whatsAppQuickReply.findMany({
          where: { workspaceId },
          orderBy: { shortcut: 'asc' },
        }),
      ])
      const migratedTo = new Map(
        migrated.map((site) => [site.sourceLandingPageId, site.id]),
      )
      const canvas = new Set(canvasTemplates.map((template) => template.id))
      return ok({
        landingPages: landingPages.map((page) => ({
          ...page,
          migratedSiteId: migratedTo.get(page.id) ?? null,
        })),
        forms,
        emailTemplates: emailTemplates.map((template) => ({
          ...template,
          canvas: canvas.has(template.id),
        })),
        mailingLists,
        connections,
        sites: sites.map(toSiteRecord),
        quickReplies,
      })
    } catch (error) {
      return err(dbError('Failed to list campaign options', error))
    }
  },

  /** `true` when every id is a live mailing list of the workspace. */
  async mailingListsExist(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<boolean>> {
    if (ids.length === 0) return ok(true)
    try {
      const count = await prisma.crmMailingList.count({
        where: { workspaceId, deletedAt: null, id: { in: ids } },
      })
      return ok(count === new Set(ids).size)
    } catch (error) {
      return err(dbError('Failed to check campaign mailing lists', error))
    }
  },
}
