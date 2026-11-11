import type { WhatsAppConnection } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Lookups of other modules used by the document send. */
export const DocumentLookupRepository = {
  /**
   * A connected WhatsApp number of the Comunicação module. Z-API first: it
   * delivers free text at any time, while Meta only inside the 24 h window.
   */
  async findConnectedWhatsApp(
    workspaceId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: {
          workspaceId,
          module: 'COMMUNICATION',
          status: 'CONNECTED',
          provider: { in: ['ZAPI', 'META'] },
        },
        orderBy: { createdAt: 'asc' },
      })
      const zapi = rows.find((row) => row.provider === 'ZAPI')
      return ok(zapi ?? rows[0] ?? null)
    } catch (error) {
      return err(dbError('Failed to find a WhatsApp connection', error))
    }
  },
}
