import type {
  ModuleKind,
  Prisma,
  WhatsAppConnection,
  WhatsAppConnectionStatus,
} from '@prisma/client'
import { whatsappConnectionConflict } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Toda leitura por workspace é escopada pelo módulo dono da conexão
 * (`COMMUNICATION` = zap, padrão; `SERVICE_DESK` = chamados): o zap nunca
 * enxerga as conexões do ServiceDesk e vice-versa. Os webhooks resolvem a
 * conexão pela instância/número, sem escopo, e leem `connection.module`.
 */
export const WhatsAppConnectionRepository = {
  async listByWorkspace(
    workspaceId: string,
    module: ModuleKind = 'COMMUNICATION',
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const connections = await prisma.whatsAppConnection.findMany({
        where: { workspaceId, module },
        orderBy: { createdAt: 'asc' },
      })
      return ok(connections)
    } catch (error) {
      return err(dbError('Failed to list whatsapp connections', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
    module: ModuleKind = 'COMMUNICATION',
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id, workspaceId, module },
      })
      return ok(connection)
    } catch (error) {
      return err(dbError('Failed to find whatsapp connection', error))
    }
  },

  async findByZapiInstanceId(
    zapiInstanceId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { zapiInstanceId, provider: 'ZAPI' },
      })
      return ok(connection)
    } catch (error) {
      return err(
        dbError('Failed to find whatsapp connection by zapi instance', error),
      )
    }
  },

  /** Meta connections of a WhatsApp Business Account (template webhooks
   * carry the WABA id, not a phone number id). */
  async listByMetaWabaId(
    metaWabaId: string,
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const connections = await prisma.whatsAppConnection.findMany({
        where: { metaWabaId, provider: 'META' },
      })
      return ok(connections)
    } catch (error) {
      return err(
        dbError('Failed to list whatsapp connections by meta waba id', error),
      )
    }
  },

  async findByMetaPhoneNumberId(
    metaPhoneNumberId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { metaPhoneNumberId, provider: 'META' },
      })
      return ok(connection)
    } catch (error) {
      return err(
        dbError(
          'Failed to find whatsapp connection by meta phone number id',
          error,
        ),
      )
    }
  },

  async create(
    data: Prisma.WhatsAppConnectionUncheckedCreateInput,
  ): Promise<Result<WhatsAppConnection>> {
    try {
      const connection = await prisma.whatsAppConnection.create({ data })
      return ok(connection)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(whatsappConnectionConflict())
      }
      return err(dbError('Failed to create whatsapp connection', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppConnectionUpdateInput,
  ): Promise<Result<WhatsAppConnection>> {
    try {
      const connection = await prisma.whatsAppConnection.update({
        where: { id },
        data,
      })
      return ok(connection)
    } catch (error) {
      return err(dbError('Failed to update whatsapp connection', error))
    }
  },

  /**
   * Moves the connection to `data.status` only if it is currently in one of
   * `from`. `true` = this call made the transition (so the caller announces
   * it once, never again while the state stays the same).
   */
  async transitionStatus(
    id: string,
    from: WhatsAppConnectionStatus[],
    data: { status: WhatsAppConnectionStatus; statusError: string | null },
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppConnection.updateMany({
        where: { id, status: { in: from } },
        data,
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to update whatsapp connection status', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppConnection.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp connection', error))
    }
  },
}
