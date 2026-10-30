import { sdInventoryDeviceStateInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import type { SdInventoryAdoptResultDTO } from '@/types/sd-inventory'
import { sdAdminMutation } from './sd-config-support'
import { ensureConfigItemForDevice } from './sd-inventory-sync.service'

/**
 * Ações manuais do admin sobre um equipamento do inventário: mesclar,
 * desfazer a mescla, adotar um descoberto e descartá-lo.
 */
export const SdInventoryDeviceActionsService = {
  /**
   * Mescla manual: `deviceId` vira ficha secundária de `intoId` (a mesma
   * máquina vista por outra origem). Vale para qualquer par, mesmo que a
   * mescla automática não o reconhecesse.
   */
  async merge(
    actorId: string,
    workspaceId: string,
    deviceId: string,
    intoId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_device',
      action: 'update',
      targetId: deviceId,
      meta: { merge: 'manual', intoId },
      run: async () => {
        if (deviceId === intoId) {
          return err(
            sdInventoryDeviceStateInvalid(
              'Escolha outro equipamento para mesclar',
            ),
          )
        }
        const device = await SdInventoryDeviceRepository.findRowById(
          deviceId,
          workspaceId,
        )
        if (!device.ok) return device
        const target = await SdInventoryDeviceRepository.findRowById(
          intoId,
          workspaceId,
        )
        if (!target.ok) return target
        if (target.value.mergedIntoId) {
          return err(
            sdInventoryDeviceStateInvalid(
              'O destino já foi mesclado em outro equipamento: escolha o principal',
            ),
          )
        }
        const merged = await SdInventoryDeviceRepository.mergeInto(
          workspaceId,
          deviceId,
          intoId,
          { lock: false },
        )
        if (!merged.ok) return merged
        return ok(undefined)
      },
    })
  },

  /**
   * Desfaz a mescla: a ficha volta a ser um equipamento próprio (com item
   * novo na CMDB, se ligado nos ajustes) e a mescla automática não a pega
   * de novo.
   */
  async unmerge(
    actorId: string,
    workspaceId: string,
    deviceId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_device',
      action: 'update',
      targetId: deviceId,
      meta: { merge: 'undo' },
      run: async () => {
        const device = await SdInventoryDeviceRepository.findRowById(
          deviceId,
          workspaceId,
        )
        if (!device.ok) return device
        if (!device.value.mergedIntoId) {
          return err(
            sdInventoryDeviceStateInvalid('Este equipamento não está mesclado'),
          )
        }
        const freed = await SdInventoryDeviceRepository.unmerge(
          workspaceId,
          deviceId,
        )
        if (!freed.ok) return freed
        if (freed.value.managed) {
          const item = await ensureConfigItemForDevice(
            workspaceId,
            actorId,
            freed.value,
          )
          if (!item.ok) return item
        }
        return ok(undefined)
      },
    })
  },

  /** Adota um descoberto: passa a ser gerido e ganha item na CMDB. */
  async adopt(
    actorId: string,
    workspaceId: string,
    deviceId: string,
  ): Promise<Result<SdInventoryAdoptResultDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_device',
      action: 'update',
      targetId: deviceId,
      meta: { adopt: true },
      run: async () => {
        const device = await SdInventoryDeviceRepository.findRowById(
          deviceId,
          workspaceId,
        )
        if (!device.ok) return device
        if (device.value.managed || device.value.mergedIntoId) {
          return err(
            sdInventoryDeviceStateInvalid(
              'Só equipamentos descobertos, ainda sem gestão, podem ser adotados',
            ),
          )
        }
        const adopted = await SdInventoryDeviceRepository.markManaged(deviceId)
        if (!adopted.ok) return adopted
        const configItemId = await ensureConfigItemForDevice(
          workspaceId,
          actorId,
          adopted.value,
        )
        if (!configItemId.ok) return configItemId
        return ok({ deviceId, configItemId: configItemId.value })
      },
    })
  },

  /** Descarta um descoberto: some da lista e a descoberta não o recria. */
  async dismiss(
    actorId: string,
    workspaceId: string,
    deviceId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_device',
      action: 'delete',
      targetId: deviceId,
      run: async () => {
        const device = await SdInventoryDeviceRepository.findRowById(
          deviceId,
          workspaceId,
        )
        if (!device.ok) return device
        if (device.value.managed) {
          return err(
            sdInventoryDeviceStateInvalid(
              'Só equipamentos descobertos, ainda sem gestão, podem ser descartados',
            ),
          )
        }
        return SdInventoryDeviceRepository.markIgnored(deviceId, workspaceId)
      },
    })
  },
}
