import type { SdInventoryToken } from '@prisma/client'
import { sdInventoryTokenNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

/**
 * Tokens do agente de inventário. Só o SHA-256 fica no banco (`tokenHash`,
 * único no banco inteiro: a entrada pública acha o workspace pelo token).
 * Revogar carimba `revokedAt` e o token deixa de valer na hora.
 */
export const SdInventoryTokenRepository = {
  async list(workspaceId: string): Promise<Result<SdInventoryToken[]>> {
    return sdDb('Failed to list ServiceDesk inventory tokens', () =>
      prisma.sdInventoryToken.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryToken>> {
    return sdDbFind(
      'Failed to find ServiceDesk inventory token',
      () => prisma.sdInventoryToken.findFirst({ where: { id, workspaceId } }),
      sdInventoryTokenNotFound(),
    )
  },

  /** Token não revogado pelo hash do valor recebido. */
  async findActiveByHash(
    tokenHash: string,
  ): Promise<Result<SdInventoryToken | null>> {
    return sdDb('Failed to find ServiceDesk inventory token by hash', () =>
      prisma.sdInventoryToken.findFirst({
        where: { tokenHash, revokedAt: null },
      }),
    )
  },

  async create(data: {
    workspaceId: string
    name: string
    tokenHash: string
    createdById: string
  }): Promise<Result<SdInventoryToken>> {
    return sdDb('Failed to create ServiceDesk inventory token', () =>
      prisma.sdInventoryToken.create({ data }),
    )
  },

  async revoke(id: string, workspaceId: string): Promise<Result<void>> {
    return sdDb('Failed to revoke ServiceDesk inventory token', async () => {
      await prisma.sdInventoryToken.update({
        where: { id, workspaceId },
        data: { revokedAt: new Date() },
      })
    })
  },

  async touch(id: string, at: Date): Promise<Result<void>> {
    return sdDb('Failed to touch ServiceDesk inventory token', async () => {
      await prisma.sdInventoryToken.update({
        where: { id },
        data: { lastUsedAt: at },
      })
    })
  },
}
