import type { WorkspaceSendingDomain } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Sending domains (ADR 0054). The contract ships the one read the other
 * slices need (`findVerifiedByName`); the sending-domains slice owns the
 * rest of this repository.
 */
export const SendingDomainRepository = {
  async findVerifiedByName(
    workspaceId: string,
    name: string,
  ): Promise<Result<WorkspaceSendingDomain | null>> {
    try {
      const domain = await prisma.workspaceSendingDomain.findFirst({
        where: { workspaceId, name, status: 'VERIFIED' },
      })
      return ok(domain)
    } catch (error) {
      return err(dbError('Failed to find verified sending domain', error))
    }
  },
}
