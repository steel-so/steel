import type {
  CrmPaymentMethod,
  CrmProposalCharge,
  CrmProposalSignature,
} from '@prisma/client'
import { crmProposalChargeNotFound, crmProposalSignatureNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmProposalChargeRepository = {
  async create(data: {
    workspaceId: string
    proposalId: string
    opportunityId: string | null
    createdById: string | null
    method: CrmPaymentMethod
    provider: string
    providerChargeId: string
    amount: number
    description: string
    paymentCode: string
    expiresAt: Date
  }): Promise<Result<CrmProposalCharge>> {
    try {
      return ok(await prisma.crmProposalCharge.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create CRM proposal charge', error))
    }
  },

  async listByProposal(
    proposalId: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalCharge[]>> {
    try {
      return ok(
        await prisma.crmProposalCharge.findMany({
          where: { proposalId, workspaceId },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM proposal charges', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalCharge>> {
    try {
      const row = await prisma.crmProposalCharge.findFirst({
        where: { id, workspaceId },
      })
      return row ? ok(row) : err(crmProposalChargeNotFound())
    } catch (error) {
      return err(dbError('Failed to find CRM proposal charge', error))
    }
  },

  /** `null` when no charge matches (a webhook for someone else's charge). */
  async findByProviderCharge(
    provider: string,
    providerChargeId: string,
  ): Promise<Result<CrmProposalCharge | null>> {
    try {
      return ok(
        await prisma.crmProposalCharge.findUnique({
          where: { provider_providerChargeId: { provider, providerChargeId } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM proposal charge by provider', error))
    }
  },

  /** Settles a charge that was not paid yet; `null` when it already was. */
  async markPaid(
    id: string,
    data: {
      paidAt: Date
      paidAmount: number
      endToEndId: string | null
      payerName: string | null
    },
  ): Promise<Result<CrmProposalCharge | null>> {
    try {
      const { count } = await prisma.crmProposalCharge.updateMany({
        where: { id, status: { not: 'PAID' } },
        data: { status: 'PAID', ...data },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.crmProposalCharge.findUniqueOrThrow({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to mark CRM proposal charge as paid', error))
    }
  },

  /** Cancels a pending charge; `null` when it no longer is pending. */
  async markCanceled(id: string): Promise<Result<CrmProposalCharge | null>> {
    try {
      const { count } = await prisma.crmProposalCharge.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELED', canceledAt: new Date() },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.crmProposalCharge.findUniqueOrThrow({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to cancel CRM proposal charge', error))
    }
  },
}

export const CrmProposalSignatureRepository = {
  async create(data: {
    id: string
    workspaceId: string
    proposalId: string
    signerName: string
    signerDocument: string | null
    signerEmail: string | null
    storageKey: string
    imageSha256: string
    proposalSha256: string
    ipHash: string
    signedAt: Date
  }): Promise<Result<CrmProposalSignature>> {
    try {
      return ok(await prisma.crmProposalSignature.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create CRM proposal signature', error))
    }
  },

  async listByProposal(
    proposalId: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalSignature[]>> {
    try {
      return ok(
        await prisma.crmProposalSignature.findMany({
          where: { proposalId, workspaceId },
          orderBy: { signedAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM proposal signatures', error))
    }
  },

  async findById(
    id: string,
    proposalId: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalSignature>> {
    try {
      const row = await prisma.crmProposalSignature.findFirst({
        where: { id, proposalId, workspaceId },
      })
      return row ? ok(row) : err(crmProposalSignatureNotFound())
    } catch (error) {
      return err(dbError('Failed to find CRM proposal signature', error))
    }
  },

  async latestByProposal(
    proposalId: string,
  ): Promise<Result<CrmProposalSignature | null>> {
    try {
      return ok(
        await prisma.crmProposalSignature.findFirst({
          where: { proposalId },
          orderBy: { signedAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to read the latest CRM proposal signature', error))
    }
  },
}
