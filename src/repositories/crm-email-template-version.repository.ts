import type {
  CrmEmailTemplateVersionReason,
  Prisma,
  CrmEmailTemplateVersion as Row,
} from '@prisma/client'
import { crmEmailTemplateVersionNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const AUTHOR = { select: { id: true, name: true } } as const

export type CrmEmailTemplateVersion = Row & {
  createdBy: { id: string; name: string } | null
}

export type CrmEmailTemplateVersionListItem = Omit<
  CrmEmailTemplateVersion,
  'document'
>

const LIST_SELECT = {
  id: true,
  templateId: true,
  workspaceId: true,
  reason: true,
  label: true,
  subject: true,
  contentHash: true,
  restoredFromId: true,
  createdById: true,
  createdAt: true,
  createdBy: AUTHOR,
} satisfies Prisma.CrmEmailTemplateVersionSelect

/** Versions kept per template; older ones are dropped on insert. */
export const TEMPLATE_VERSION_LIMIT = 50

export interface NewCrmEmailTemplateVersion {
  templateId: string
  workspaceId: string
  reason: CrmEmailTemplateVersionReason
  label?: string | null
  subject: string
  document: Prisma.InputJsonValue
  contentHash: string
  restoredFromId?: string | null
  createdById: string
}

/** Version history of v2 e-mail templates. */
export const CrmEmailTemplateVersionRepository = {
  async list(
    templateId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailTemplateVersionListItem[]>> {
    try {
      const versions = await prisma.crmEmailTemplateVersion.findMany({
        where: { templateId, workspaceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: LIST_SELECT,
        take: TEMPLATE_VERSION_LIMIT,
      })
      return ok(versions)
    } catch (error) {
      return err(dbError('Failed to list CRM email template versions', error))
    }
  },

  async findById(
    id: string,
    templateId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailTemplateVersion>> {
    try {
      const version = await prisma.crmEmailTemplateVersion.findFirst({
        where: { id, templateId, workspaceId },
        include: { createdBy: AUTHOR },
      })
      if (!version) return err(crmEmailTemplateVersionNotFound())
      return ok(version)
    } catch (error) {
      return err(dbError('Failed to find CRM email template version', error))
    }
  },

  /** Hash of the newest version (`null` when there is none). */
  async latestHash(templateId: string): Promise<Result<string | null>> {
    try {
      const latest = await prisma.crmEmailTemplateVersion.findFirst({
        where: { templateId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { contentHash: true },
      })
      return ok(latest?.contentHash ?? null)
    } catch (error) {
      return err(dbError('Failed to find the latest template version', error))
    }
  },

  /** Inserts a version and trims the history to the newest `keep`. */
  async create(
    data: NewCrmEmailTemplateVersion,
    keep = TEMPLATE_VERSION_LIMIT,
  ): Promise<Result<CrmEmailTemplateVersionListItem>> {
    try {
      const version = await prisma.$transaction(async (tx) => {
        const created = await tx.crmEmailTemplateVersion.create({
          data,
          select: LIST_SELECT,
        })
        const stale = await tx.crmEmailTemplateVersion.findMany({
          where: { templateId: data.templateId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: keep,
          select: { id: true },
        })
        if (stale.length > 0) {
          await tx.crmEmailTemplateVersion.deleteMany({
            where: { id: { in: stale.map((row) => row.id) } },
          })
        }
        return created
      })
      return ok(version)
    } catch (error) {
      return err(dbError('Failed to create CRM email template version', error))
    }
  },
}
