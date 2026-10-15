import type { CrmEmailBrand, Prisma } from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmEmailBrandInput } from '@/src/schemas/crm-email-builder.schema'
import { dbError } from './db-error'

/** CRM person fields used to fill the e-mail variables. */
export type PersonalizationContact = {
  id: string
  name: string
  emails: string[]
  phones: string[]
  city: string | null
  jobTitle: string | null
  companyName: string | null
}

/** CRM product fields an e-mail product block shows. */
export type EmailProductRow = {
  id: string
  name: string
  description: string | null
  unitPrice: Prisma.Decimal
  currency: string
}

export type EmailLinkTargets = {
  landingPages: { id: string; title: string; shareToken: string }[]
  forms: { id: string; name: string; publicToken: string }[]
}

/** Data access of the visual e-mail builder (brand, contacts, link picks). */
export const CrmEmailBuilderRepository = {
  async findBrand(workspaceId: string): Promise<Result<CrmEmailBrand | null>> {
    try {
      const brand = await prisma.crmEmailBrand.findUnique({
        where: { workspaceId },
      })
      return ok(brand)
    } catch (error) {
      return err(dbError('Failed to find CRM email brand', error))
    }
  },

  async upsertBrand(
    workspaceId: string,
    data: CrmEmailBrandInput,
    updatedById: string,
  ): Promise<Result<CrmEmailBrand>> {
    try {
      const brand = await prisma.crmEmailBrand.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data, updatedById },
        update: { ...data, updatedById },
      })
      return ok(brand)
    } catch (error) {
      return err(dbError('Failed to save CRM email brand', error))
    }
  },

  async findWorkspaceIdentity(
    workspaceId: string,
  ): Promise<Result<{ name: string; logoUrl: string | null }>> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true, logoUrl: true },
      })
      if (!workspace) return err(notFound('Workspace'))
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to find workspace identity', error))
    }
  },

  /** People of the workspace (not deleted) with their company name. */
  async findContacts(
    workspaceId: string,
    personIds: string[],
  ): Promise<Result<PersonalizationContact[]>> {
    if (personIds.length === 0) return ok([])
    try {
      const people = await prisma.crmPerson.findMany({
        where: { id: { in: personIds }, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          emails: true,
          phones: true,
          city: true,
          jobTitle: true,
          company: { select: { name: true } },
        },
      })
      return ok(
        people.map(({ company, ...person }) => ({
          ...person,
          companyName: company?.name ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM contacts for e-mail', error))
    }
  },

  /** Products of the workspace (not deleted) used by product blocks. */
  async findProducts(
    workspaceId: string,
    productIds: string[],
  ): Promise<Result<EmailProductRow[]>> {
    if (productIds.length === 0) return ok([])
    try {
      const products = await prisma.crmProduct.findMany({
        where: { id: { in: productIds }, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          description: true,
          unitPrice: true,
          currency: true,
        },
      })
      return ok(products)
    } catch (error) {
      return err(dbError('Failed to find CRM products for e-mail', error))
    }
  },

  async listPublishedLinkTargets(
    workspaceId: string,
  ): Promise<Result<EmailLinkTargets>> {
    try {
      const where = {
        workspaceId,
        status: 'PUBLISHED',
        deletedAt: null,
      } as const
      const [landingPages, forms] = await Promise.all([
        prisma.crmLandingPage.findMany({
          where,
          select: { id: true, title: true, shareToken: true },
          orderBy: { title: 'asc' },
        }),
        prisma.crmForm.findMany({
          where,
          select: { id: true, name: true, publicToken: true },
          orderBy: { name: 'asc' },
        }),
      ])
      return ok({ landingPages, forms })
    } catch (error) {
      return err(dbError('Failed to list e-mail link targets', error))
    }
  },

  async findUserIdentity(
    userId: string,
  ): Promise<Result<{ email: string; name: string }>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      })
      if (!user) return err(notFound('User'))
      return ok(user)
    } catch (error) {
      return err(dbError('Failed to find user identity', error))
    }
  },
}
