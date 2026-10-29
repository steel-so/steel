import type {
  Prisma,
  WhatsAppPixCharge,
  WhatsAppPixSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Charges a timeline lists at most (newest first). */
export const PIX_CHARGE_LIST_LIMIT = 50

export const WhatsAppPixSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppPixSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppPixSettings.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp pix settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<Prisma.WhatsAppPixSettingsUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<WhatsAppPixSettings>> {
    try {
      return ok(
        await prisma.whatsAppPixSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp pix settings', error))
    }
  },
}

export const WhatsAppPixChargeRepository = {
  async create(
    data: Prisma.WhatsAppPixChargeUncheckedCreateInput,
  ): Promise<Result<WhatsAppPixCharge>> {
    try {
      return ok(await prisma.whatsAppPixCharge.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp pix charge', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPixCharge | null>> {
    try {
      return ok(
        await prisma.whatsAppPixCharge.findFirst({
          where: { id, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp pix charge', error))
    }
  },

  async findByProviderCharge(
    provider: string,
    providerChargeId: string,
  ): Promise<Result<WhatsAppPixCharge | null>> {
    try {
      return ok(
        await prisma.whatsAppPixCharge.findUnique({
          where: { provider_providerChargeId: { provider, providerChargeId } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp pix charge', error))
    }
  },

  async listByConversation(
    conversationId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPixCharge[]>> {
    try {
      return ok(
        await prisma.whatsAppPixCharge.findMany({
          where: { conversationId, workspaceId },
          orderBy: { createdAt: 'desc' },
          take: PIX_CHARGE_LIST_LIMIT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp pix charges', error))
    }
  },

  async listByOpportunity(
    opportunityId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPixCharge[]>> {
    try {
      return ok(
        await prisma.whatsAppPixCharge.findMany({
          where: { opportunityId, workspaceId },
          orderBy: { createdAt: 'desc' },
          take: PIX_CHARGE_LIST_LIMIT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp pix charges', error))
    }
  },

  /**
   * Marks the charge as paid unless it already is (so a repeated webhook
   * changes nothing). Returns the updated row, or `null` when it was already
   * paid.
   */
  async markPaid(
    id: string,
    data: {
      paidAt: Date
      paidAmount: number
      endToEndId: string | null
      payerName: string | null
    },
  ): Promise<Result<WhatsAppPixCharge | null>> {
    try {
      const { count } = await prisma.whatsAppPixCharge.updateMany({
        where: { id, status: { not: 'PAID' } },
        data: { status: 'PAID', ...data },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.whatsAppPixCharge.findUniqueOrThrow({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to mark whatsapp pix charge as paid', error))
    }
  },

  /** Cancels a charge that is still pending; `null` when it no longer is. */
  async markCanceled(id: string): Promise<Result<WhatsAppPixCharge | null>> {
    try {
      const { count } = await prisma.whatsAppPixCharge.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELED', canceledAt: new Date() },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.whatsAppPixCharge.findUniqueOrThrow({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to cancel whatsapp pix charge', error))
    }
  },
}
