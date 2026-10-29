import { createHash, randomBytes } from 'node:crypto'
import { ok, type Result } from '@/src/lib/result'
import {
  toSdInventoryTokenDTO,
  toSdInventoryTokenWithValueDTO,
} from '@/src/mappers/sd-inventory.mapper'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import type { CreateSdInventoryTokenDTO } from '@/src/schemas/sd-inventory.schema'
import type {
  SdInventoryTokenDTO,
  SdInventoryTokenWithValueDTO,
} from '@/types/sd-inventory'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'

/**
 * Tokens do agente de inventário (um ou mais por workspace). Igual ao token
 * do monitoramento: 32 bytes em base64url, mostrado **uma única vez** e
 * guardado só como SHA-256. Perdeu o valor? Revogue e gere outro.
 */

export function newSdInventoryToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashSdInventoryToken(token) }
}

export function hashSdInventoryToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const SdInventoryTokenService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryTokenDTO[]>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdInventoryTokenRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdInventoryTokenDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdInventoryTokenDTO,
  ): Promise<Result<SdInventoryTokenWithValueDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_token',
      action: 'create',
      targetId: (value) => value.id,
      run: async () => {
        const { token, hash } = newSdInventoryToken()
        const created = await SdInventoryTokenRepository.create({
          workspaceId,
          name: dto.name,
          tokenHash: hash,
          createdById: actorId,
        })
        if (!created.ok) return created
        return ok(toSdInventoryTokenWithValueDTO(created.value, token))
      },
    })
  },

  async revoke(
    actorId: string,
    workspaceId: string,
    tokenId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_token',
      action: 'delete',
      targetId: tokenId,
      run: async () => {
        const existing = await SdInventoryTokenRepository.findById(
          tokenId,
          workspaceId,
        )
        if (!existing.ok) return existing
        return SdInventoryTokenRepository.revoke(tokenId, workspaceId)
      },
    })
  },
}
