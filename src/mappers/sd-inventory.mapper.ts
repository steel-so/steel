import type {
  SdInventoryAgentRelease,
  SdInventoryDiscoveryRange,
  SdInventorySettings,
  SdInventorySnmpTarget,
  SdInventoryToken,
} from '@prisma/client'
import { isInventoryStale, usagePercent } from '@/src/lib/servicedesk/inventory'
import type { SdInventoryAlertRow } from '@/src/repositories/sd-inventory-alert.repository'
import type {
  SdInventoryDeviceDetailRow,
  SdInventoryDeviceRow,
  SdInventorySoftwareGroup,
} from '@/src/repositories/sd-inventory-device.repository'
import type {
  SdInventoryAgentReleaseDTO,
  SdInventoryAlertDTO,
  SdInventoryDeviceDetailDTO,
  SdInventoryDeviceDTO,
  SdInventoryDiscoveryRangeDTO,
  SdInventoryDiskDTO,
  SdInventorySettingsDTO,
  SdInventorySnmpTargetDTO,
  SdInventorySoftwareCatalogRowDTO,
  SdInventoryTokenDTO,
  SdInventoryTokenWithValueDTO,
} from '@/types/sd-inventory'

/** Padrões usados enquanto o workspace não salvou nenhum ajuste. */
export const SD_INVENTORY_DEFAULT_SETTINGS: SdInventorySettingsDTO = {
  diskThresholdPercent: 90,
  ramThresholdPercent: 90,
  staleAfterDays: 7,
  syncConfigItems: true,
  defaultTypeId: null,
  agentAutoUpdate: false,
}

export function toSdInventorySettingsDTO(
  settings: SdInventorySettings | null,
): SdInventorySettingsDTO {
  if (!settings) return { ...SD_INVENTORY_DEFAULT_SETTINGS }
  return {
    diskThresholdPercent: settings.diskThresholdPercent,
    ramThresholdPercent: settings.ramThresholdPercent,
    staleAfterDays: settings.staleAfterDays,
    syncConfigItems: settings.syncConfigItems,
    defaultTypeId: settings.defaultTypeId,
    agentAutoUpdate: settings.agentAutoUpdate,
  }
}

/** Lê o JSON `disks` sem confiar no formato gravado. */
export function parseSdInventoryDisks(value: unknown): SdInventoryDiskDTO[] {
  if (!Array.isArray(value)) return []
  const out: SdInventoryDiskDTO[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const disk = entry as Record<string, unknown>
    if (typeof disk.mount !== 'string') continue
    const totalMb = typeof disk.totalMb === 'number' ? disk.totalMb : 0
    const usedMb = typeof disk.usedMb === 'number' ? disk.usedMb : 0
    out.push({
      mount: disk.mount,
      label: typeof disk.label === 'string' ? disk.label : null,
      fs: typeof disk.fs === 'string' ? disk.fs : null,
      totalMb,
      usedMb,
      usedPercent: usagePercent(usedMb, totalMb),
    })
  }
  return out
}

export function toSdInventoryDeviceDTO(
  row: SdInventoryDeviceRow,
  options: { staleAfterDays: number; now?: Date },
): SdInventoryDeviceDTO {
  return {
    id: row.id,
    source: row.source,
    hostname: row.hostname,
    osName: row.osName,
    osVersion: row.osVersion,
    arch: row.arch,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    cpuModel: row.cpuModel,
    cpuCores: row.cpuCores,
    ramTotalMb: row.ramTotalMb,
    ramUsedMb: row.ramUsedMb,
    ramUsedPercent:
      row.ramTotalMb && row.ramUsedMb !== null
        ? usagePercent(row.ramUsedMb, row.ramTotalMb)
        : null,
    ipAddresses: row.ipAddresses,
    macAddresses: row.macAddresses,
    disks: parseSdInventoryDisks(row.disks),
    agentVersion: row.agentVersion,
    configItemId: row.configItemId,
    snmpTargetId: row.snmpTargetId,
    managed: row.managed,
    mergedIntoId: row.mergedIntoId,
    mergeLocked: row.mergeLocked,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    stale: isInventoryStale(
      row.lastSeenAt,
      options.staleAfterDays,
      options.now,
    ),
    openAlerts: row._count.alerts,
  }
}

export function toSdInventoryAlertDTO(
  row: SdInventoryAlertRow,
): SdInventoryAlertDTO {
  return {
    id: row.id,
    deviceId: row.deviceId,
    hostname: row.device.hostname,
    kind: row.kind,
    mount: row.mount,
    status: row.status,
    usedPercent: row.usedPercent,
    threshold: row.threshold,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }
}

export function toSdInventoryDeviceDetailDTO(
  row: SdInventoryDeviceDetailRow,
  options: { staleAfterDays: number; now?: Date },
): SdInventoryDeviceDetailDTO {
  return {
    ...toSdInventoryDeviceDTO(row, options),
    configItemName: row.configItem?.name ?? null,
    mergedIntoHostname: row.mergedInto?.hostname ?? null,
    mergedSources: row.mergedFrom.map((child) => ({
      id: child.id,
      hostname: child.hostname,
      source: child.source,
    })),
    software: row.software.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      publisher: item.publisher,
    })),
    alerts: row.alerts.map((alert) => ({
      id: alert.id,
      deviceId: alert.deviceId,
      hostname: row.hostname,
      kind: alert.kind,
      mount: alert.mount,
      status: alert.status,
      usedPercent: alert.usedPercent,
      threshold: alert.threshold,
      openedAt: alert.openedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    })),
  }
}

export function toSdInventorySoftwareCatalogRowDTO(
  group: SdInventorySoftwareGroup,
): SdInventorySoftwareCatalogRowDTO {
  return { ...group }
}

export function toSdInventoryTokenDTO(
  token: SdInventoryToken,
): SdInventoryTokenDTO {
  return {
    id: token.id,
    name: token.name,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    revokedAt: token.revokedAt?.toISOString() ?? null,
  }
}

export function toSdInventoryTokenWithValueDTO(
  token: SdInventoryToken,
  value: string,
): SdInventoryTokenWithValueDTO {
  return { ...toSdInventoryTokenDTO(token), token: value }
}

/** A community nunca sai: só informa que existe uma guardada. */
export function toSdInventorySnmpTargetDTO(
  target: SdInventorySnmpTarget,
): SdInventorySnmpTargetDTO {
  return {
    id: target.id,
    name: target.name,
    ranges: target.ranges,
    port: target.port,
    intervalMinutes: target.intervalMinutes,
    active: target.active,
    customerId: target.customerId,
    snmpVersion: target.snmpVersion,
    hasCommunity: target.communityEnc !== '',
    v3Username: target.v3Username,
    v3AuthProtocol: target.v3AuthProtocol,
    v3PrivProtocol: target.v3PrivProtocol,
    hasV3AuthKey: !!target.v3AuthKeyEnc,
    hasV3PrivKey: !!target.v3PrivKeyEnc,
    nextRunAt: target.nextRunAt?.toISOString() ?? null,
    lastRunAt: target.lastRunAt?.toISOString() ?? null,
    lastStatus: target.lastStatus,
    lastFound: target.lastFound,
    lastError: target.lastError,
    createdAt: target.createdAt.toISOString(),
  }
}

export function toSdInventoryDiscoveryRangeDTO(
  range: SdInventoryDiscoveryRange,
): SdInventoryDiscoveryRangeDTO {
  return {
    id: range.id,
    name: range.name,
    cidr: range.cidr,
    enabled: range.enabled,
    intervalMinutes: range.intervalMinutes,
    customerId: range.customerId,
    nextRunAt: range.nextRunAt?.toISOString() ?? null,
    lastRunAt: range.lastRunAt?.toISOString() ?? null,
    lastStatus: range.lastStatus,
    lastProbed: range.lastProbed,
    lastFound: range.lastFound,
    lastError: range.lastError,
    createdAt: range.createdAt.toISOString(),
  }
}

export function toSdInventoryAgentReleaseDTO(
  release: SdInventoryAgentRelease,
): SdInventoryAgentReleaseDTO {
  return {
    id: release.id,
    version: release.version,
    os: release.os,
    arch: release.arch,
    sha256: release.sha256,
    sizeBytes: release.sizeBytes,
    active: release.active,
    publishedAt: release.publishedAt.toISOString(),
  }
}
