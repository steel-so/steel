import type { Result } from '@/src/lib/result'
import { ok } from '@/src/lib/result'
import { toSdInventorySettingsDTO } from '@/src/mappers/sd-inventory.mapper'
import { SdConfigItemTypeRepository } from '@/src/repositories/sd-config-item-type.repository'
import { SdInventorySettingsRepository } from '@/src/repositories/sd-inventory-settings.repository'
import type { UpdateSdInventorySettingsDTO } from '@/src/schemas/sd-inventory.schema'
import type { SdInventorySettingsDTO } from '@/types/sd-inventory'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'

async function loadSettings(
  workspaceId: string,
): Promise<Result<SdInventorySettingsDTO>> {
  const row = await SdInventorySettingsRepository.find(workspaceId)
  if (!row.ok) return row
  return ok(toSdInventorySettingsDTO(row.value))
}

export const SdInventorySettingsService = {
  /** Sem autorização: uso interno (ingestão e worker). */
  load: loadSettings,

  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdInventorySettingsDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    return loadSettings(workspaceId)
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateSdInventorySettingsDTO,
  ): Promise<Result<SdInventorySettingsDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_settings',
      action: 'update',
      targetId: workspaceId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        if (dto.defaultTypeId) {
          const type = await SdConfigItemTypeRepository.findById(
            dto.defaultTypeId,
            workspaceId,
          )
          if (!type.ok) return type
        }
        const saved = await SdInventorySettingsRepository.upsert(
          workspaceId,
          dto,
        )
        if (!saved.ok) return saved
        return ok(toSdInventorySettingsDTO(saved.value))
      },
    })
  },
}
