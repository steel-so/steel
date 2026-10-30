import { createId } from '@paralleldrive/cuid2'
import type {
  CrmForm,
  CrmFormAction,
  CrmFormSubmission,
  Prisma,
} from '@prisma/client'
import { crmFormNotPublished, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmFormRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<CrmForm[]>> {
    try {
      const forms = await prisma.crmForm.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { position: 'asc' },
      })
      return ok(forms)
    } catch (error) {
      return err(dbError('Failed to list CRM forms', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<CrmForm>> {
    try {
      const form = await prisma.crmForm.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!form) return err(notFound('CrmForm'))
      return ok(form)
    } catch (error) {
      return err(dbError('Failed to find CRM form by id', error))
    }
  },

  async findPublishedByPublicToken(
    publicToken: string,
  ): Promise<Result<CrmForm>> {
    try {
      const form = await prisma.crmForm.findFirst({
        where: { publicToken, deletedAt: null },
      })
      if (!form) return err(notFound('CrmForm'))
      if (form.status !== 'PUBLISHED') return err(crmFormNotPublished())
      return ok(form)
    } catch (error) {
      return err(dbError('Failed to find CRM form by public token', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    description?: string
    action?: CrmFormAction
    fields?: Prisma.InputJsonValue
    phases?: Prisma.InputJsonValue
    successMessage?: string
    redirectUrl?: string
  }): Promise<Result<CrmForm>> {
    try {
      const position = await prisma.crmForm.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })
      const form = await prisma.crmForm.create({
        data: { ...data, publicToken: createId(), position },
      })
      return ok(form)
    } catch (error) {
      return err(dbError('Failed to create CRM form', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      description?: string
      action?: CrmFormAction
      fields?: Prisma.InputJsonValue
      phases?: Prisma.InputJsonValue
      status?: 'DRAFT' | 'PUBLISHED'
      publishedAt?: Date | null
      successMessage?: string
      redirectUrl?: string
      newsletterId?: string | null
      bookingPageId?: string | null
      updatedById?: string
    },
  ): Promise<Result<CrmForm>> {
    try {
      const form = await prisma.crmForm.update({ where: { id }, data })
      return ok(form)
    } catch (error) {
      return err(dbError('Failed to update CRM form', error))
    }
  },

  async setPublished(id: string, published: boolean): Promise<Result<CrmForm>> {
    try {
      const form = await prisma.crmForm.update({
        where: { id },
        data: {
          status: published ? 'PUBLISHED' : 'DRAFT',
          publishedAt: published ? new Date() : null,
        },
      })
      return ok(form)
    } catch (error) {
      return err(dbError('Failed to publish CRM form', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmForm.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM form', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmForm.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM forms', error))
    }
  },
}

export const CrmFormSubmissionRepository = {
  async listByForm(formId: string): Promise<Result<CrmFormSubmission[]>> {
    try {
      const submissions = await prisma.crmFormSubmission.findMany({
        where: { formId },
        orderBy: { createdAt: 'desc' },
      })
      return ok(submissions)
    } catch (error) {
      return err(dbError('Failed to list CRM form submissions', error))
    }
  },

  async create(data: {
    formId: string
    values: Prisma.InputJsonValue
    action: CrmFormAction
    createdPersonId?: string
    createdCompanyId?: string
    createdLeadId?: string
    ipHash?: string
    referrer?: string
  }): Promise<Result<CrmFormSubmission>> {
    try {
      const [submission] = await prisma.$transaction([
        prisma.crmFormSubmission.create({ data }),
        prisma.crmForm.update({
          where: { id: data.formId },
          data: { submissionCount: { increment: 1 } },
        }),
      ])
      return ok(submission)
    } catch (error) {
      return err(dbError('Failed to create CRM form submission', error))
    }
  },
}
