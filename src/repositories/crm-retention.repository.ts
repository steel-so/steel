import {
  type CrmOpportunity,
  type CrmRetentionSettings,
  type CrmRetentionSource,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Company and owner behind a CRM person, for the retention follow-up. */
export interface RetentionPersonContext {
  personId: string
  personName: string
  companyId: string | null
  companyName: string | null
  accountOwnerId: string | null
}

export const CrmRetentionRepository = {
  /** `null` = the workspace never saved settings (defaults apply). */
  async findSettings(
    workspaceId: string,
  ): Promise<Result<CrmRetentionSettings | null>> {
    try {
      return ok(
        await prisma.crmRetentionSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM retention settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: {
      onDetractor?: boolean
      onHealthDrop?: boolean
      createOpportunity?: boolean
      taskDueDays?: number
      updatedById: string
    },
  ): Promise<Result<CrmRetentionSettings>> {
    try {
      return ok(
        await prisma.crmRetentionSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save CRM retention settings', error))
    }
  },

  /**
   * Claims the idempotency key. `true` = this call owns the follow-up,
   * `false` = it was already claimed (unique violation).
   */
  async claim(
    workspaceId: string,
    source: CrmRetentionSource,
    dedupeKey: string,
  ): Promise<Result<boolean>> {
    try {
      await prisma.crmRetentionAction.create({
        data: { workspaceId, source, dedupeKey },
      })
      return ok(true)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return ok(false)
      }
      return err(dbError('Failed to claim a CRM retention action', error))
    }
  },

  /** Records what the claimed follow-up created. */
  async complete(
    workspaceId: string,
    dedupeKey: string,
    data: { taskId?: string | null; opportunityId?: string | null },
  ): Promise<Result<true>> {
    try {
      await prisma.crmRetentionAction.update({
        where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } },
        data,
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to complete a CRM retention action', error))
    }
  },

  /** Gives the key back so a later retry can run again. */
  async release(workspaceId: string, dedupeKey: string): Promise<Result<true>> {
    try {
      await prisma.crmRetentionAction.deleteMany({
        where: { workspaceId, dedupeKey },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to release a CRM retention action', error))
    }
  },

  /** A CRM person with its company and the company's account owner. */
  async findPersonContext(
    workspaceId: string,
    personId: string,
  ): Promise<Result<RetentionPersonContext | null>> {
    try {
      const person = await prisma.crmPerson.findFirst({
        where: { id: personId, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          company: {
            select: { id: true, name: true, accountOwnerId: true },
          },
        },
      })
      if (!person) return ok(null)
      return ok({
        personId: person.id,
        personName: person.name,
        companyId: person.company?.id ?? null,
        companyName: person.company?.name ?? null,
        accountOwnerId: person.company?.accountOwnerId ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to find the CRM person context', error))
    }
  },

  /** Most recently updated person that has this e-mail. */
  async findPersonIdByEmail(
    workspaceId: string,
    email: string,
  ): Promise<Result<string | null>> {
    try {
      const person = await prisma.crmPerson.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          emails: { has: email.toLowerCase() },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      return ok(person?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find a CRM person by e-mail', error))
    }
  },

  /** WhatsApp number (`waId`) of a contact of the workspace. */
  async findContactPhone(
    workspaceId: string,
    contactId: string,
  ): Promise<Result<string | null>> {
    try {
      const contact = await prisma.whatsAppContact.findFirst({
        where: { id: contactId, workspaceId },
        select: { waId: true },
      })
      return ok(contact?.waId ?? null)
    } catch (error) {
      return err(dbError('Failed to find the WhatsApp contact phone', error))
    }
  },

  /** Name and account owner of a company of the workspace. */
  async findCompany(
    workspaceId: string,
    companyId: string,
  ): Promise<
    Result<{ id: string; name: string; accountOwnerId: string | null } | null>
  > {
    try {
      const company = await prisma.crmCompany.findFirst({
        where: { id: companyId, workspaceId, deletedAt: null },
        select: { id: true, name: true, accountOwnerId: true },
      })
      return ok(company)
    } catch (error) {
      return err(dbError('Failed to find the CRM company', error))
    }
  },

  /**
   * Where a retention deal goes: first OPEN stage (lowest position) of the
   * default pipeline, or of the first pipeline when none is the default.
   */
  async findRetentionStage(
    workspaceId: string,
  ): Promise<Result<{ pipelineId: string; stageId: string } | null>> {
    try {
      const pipeline = await prisma.crmPipeline.findFirst({
        where: { workspaceId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: {
          id: true,
          stages: {
            where: { category: 'OPEN' },
            orderBy: { position: 'asc' },
            take: 1,
            select: { id: true },
          },
        },
      })
      const stage = pipeline?.stages[0]
      if (!pipeline || !stage) return ok(null)
      return ok({ pipelineId: pipeline.id, stageId: stage.id })
    } catch (error) {
      return err(dbError('Failed to find the retention pipeline stage', error))
    }
  },

  /** An open deal of the company already covers the retention need. */
  async findOpenOpportunityOfCompany(
    workspaceId: string,
    companyId: string,
  ): Promise<Result<Pick<CrmOpportunity, 'id'> | null>> {
    try {
      return ok(
        await prisma.crmOpportunity.findFirst({
          where: {
            workspaceId,
            companyId,
            deletedAt: null,
            source: 'retention',
            stage: { category: 'OPEN' },
          },
          select: { id: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find the open retention deal', error))
    }
  },

  /** First OWNER/ADMIN, the fallback author/assignee of an automatic task. */
  async findFallbackUserId(
    workspaceId: string,
  ): Promise<Result<string | null>> {
    try {
      const membership = await prisma.membership.findFirst({
        where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { userId: true },
      })
      return ok(membership?.userId ?? null)
    } catch (error) {
      return err(dbError('Failed to find the fallback retention user', error))
    }
  },
}
