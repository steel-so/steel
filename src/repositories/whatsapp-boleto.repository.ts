import type {
  Prisma,
  WhatsAppBoletoCharge,
  WhatsAppBoletoSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const BOLETO_CHARGE_LIST_LIMIT = 50

export const WhatsAppBoletoSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppBoletoSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppBoletoSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp boleto settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<Prisma.WhatsAppBoletoSettingsUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<WhatsAppBoletoSettings>> {
    try {
      return ok(
        await prisma.whatsAppBoletoSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp boleto settings', error))
    }
  },
}

export const WhatsAppBoletoChargeRepository = {
  async create(
    data: Prisma.WhatsAppBoletoChargeUncheckedCreateInput,
  ): Promise<Result<WhatsAppBoletoCharge>> {
    try {
      return ok(await prisma.whatsAppBoletoCharge.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp boleto charge', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBoletoCharge | null>> {
    try {
      return ok(
        await prisma.whatsAppBoletoCharge.findFirst({
          where: { id, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp boleto charge', error))
    }
  },

  async findByProviderCharge(
    provider: string,
    providerChargeId: string,
  ): Promise<Result<WhatsAppBoletoCharge | null>> {
    try {
      return ok(
        await prisma.whatsAppBoletoCharge.findUnique({
          where: { provider_providerChargeId: { provider, providerChargeId } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp boleto charge', error))
    }
  },

  async listByConversation(
    conversationId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBoletoCharge[]>> {
    try {
      return ok(
        await prisma.whatsAppBoletoCharge.findMany({
          where: { conversationId, workspaceId },
          orderBy: { createdAt: 'desc' },
          take: BOLETO_CHARGE_LIST_LIMIT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp boleto charges', error))
    }
  },

  /** Marks paid unless it already is; `null` when it already was. */
  async markPaid(
    id: string,
    data: { paidAt: Date; paidAmount: number },
  ): Promise<Result<WhatsAppBoletoCharge | null>> {
    return updateWhere(id, { status: { not: 'PAID' } }, { status: 'PAID', ...data })
  },

  /** Cancels a charge that is still pending; `null` when it no longer is. */
  async markCanceled(id: string): Promise<Result<WhatsAppBoletoCharge | null>> {
    return updateWhere(
      id,
      { status: 'PENDING' },
      { status: 'CANCELED', canceledAt: new Date() },
    )
  },

  /** Refunded by the PSP: only a paid charge can be refunded. */
  async markRefunded(id: string): Promise<Result<WhatsAppBoletoCharge | null>> {
    return updateWhere(id, { status: 'PAID' }, { status: 'REFUNDED' })
  },

  /** Expired by the PSP: only a pending charge can expire. */
  async markExpired(id: string): Promise<Result<WhatsAppBoletoCharge | null>> {
    return updateWhere(id, { status: 'PENDING' }, { status: 'EXPIRED' })
  },
}

async function updateWhere(
  id: string,
  where: Prisma.WhatsAppBoletoChargeWhereInput,
  data: Prisma.WhatsAppBoletoChargeUncheckedUpdateManyInput,
): Promise<Result<WhatsAppBoletoCharge | null>> {
  try {
    const { count } = await prisma.whatsAppBoletoCharge.updateMany({
      where: { id, ...where },
      data,
    })
    if (count === 0) return ok(null)
    return ok(
      await prisma.whatsAppBoletoCharge.findUniqueOrThrow({ where: { id } }),
    )
  } catch (error) {
    return err(dbError('Failed to update whatsapp boleto charge', error))
  }
}
