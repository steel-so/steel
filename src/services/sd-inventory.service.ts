import { ok, type Result } from '@/src/lib/result'
import {
  toSdInventoryAlertDTO,
  toSdInventoryDeviceDetailDTO,
  toSdInventoryDeviceDTO,
  toSdInventorySoftwareCatalogRowDTO,
} from '@/src/mappers/sd-inventory.mapper'
import { SdInventoryAlertRepository } from '@/src/repositories/sd-inventory-alert.repository'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import type {
  ListSdInventoryAlertsDTO,
  ListSdInventoryDevicesDTO,
  ListSdInventorySoftwareDTO,
} from '@/src/schemas/sd-inventory.schema'
import type { SdPage } from '@/types/sd-directory'
import type {
  SdInventoryAlertDTO,
  SdInventoryDeviceDetailDTO,
  SdInventoryDeviceDTO,
  SdInventorySoftwareCatalogRowDTO,
  SdInventorySummaryDTO,
} from '@/types/sd-inventory'
import { SdAccess } from './sd-access'
import { SdInventorySettingsService } from './sd-inventory-settings.service'

const DAY_MS = 86_400_000

function staleBefore(staleAfterDays: number, now: Date): Date {
  return new Date(now.getTime() - staleAfterDays * DAY_MS)
}

/** Consultas do inventário para a tela: só agentes do ServiceDesk. */
export const SdInventoryService = {
  async summary(
    actorId: string,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<SdInventorySummaryDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const settings = await SdInventorySettingsService.load(workspaceId)
    if (!settings.ok) return settings
    return SdInventoryDeviceRepository.summary(
      workspaceId,
      staleBefore(settings.value.staleAfterDays, now),
    )
  },

  async listDevices(
    actorId: string,
    workspaceId: string,
    filters: ListSdInventoryDevicesDTO,
    now: Date = new Date(),
  ): Promise<Result<SdPage<SdInventoryDeviceDTO>>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const settings = await SdInventorySettingsService.load(workspaceId)
    if (!settings.ok) return settings
    const { staleAfterDays } = settings.value

    const result = await SdInventoryDeviceRepository.list(
      workspaceId,
      filters,
      staleBefore(staleAfterDays, now),
    )
    if (!result.ok) return result
    return ok({
      items: result.value.items.map((row) =>
        toSdInventoryDeviceDTO(row, { staleAfterDays, now }),
      ),
      total: result.value.total,
      page: filters.page,
      pageSize: filters.pageSize,
    })
  },

  async getDevice(
    actorId: string,
    workspaceId: string,
    deviceId: string,
    now: Date = new Date(),
  ): Promise<Result<SdInventoryDeviceDetailDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const settings = await SdInventorySettingsService.load(workspaceId)
    if (!settings.ok) return settings
    const row = await SdInventoryDeviceRepository.findById(
      deviceId,
      workspaceId,
    )
    if (!row.ok) return row
    return ok(
      toSdInventoryDeviceDetailDTO(row.value, {
        staleAfterDays: settings.value.staleAfterDays,
        now,
      }),
    )
  },

  async listAlerts(
    actorId: string,
    workspaceId: string,
    filters: ListSdInventoryAlertsDTO,
  ): Promise<Result<SdInventoryAlertDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdInventoryAlertRepository.list(workspaceId, filters)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdInventoryAlertDTO))
  },

  /** Catálogo de software instalado (base da gestão de licenças, S7). */
  async listSoftware(
    actorId: string,
    workspaceId: string,
    filters: ListSdInventorySoftwareDTO,
  ): Promise<Result<SdPage<SdInventorySoftwareCatalogRowDTO>>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const result = await SdInventoryDeviceRepository.listSoftware(
      workspaceId,
      filters,
    )
    if (!result.ok) return result
    return ok({
      items: result.value.items.map(toSdInventorySoftwareCatalogRowDTO),
      total: result.value.total,
      page: filters.page,
      pageSize: filters.pageSize,
    })
  },
}
