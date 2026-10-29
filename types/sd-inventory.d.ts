/**
 * DTOs do inventário de ativos do ServiceDesk (S1). O token do agente e a
 * community SNMP **nunca** entram num DTO de leitura: o token aparece uma vez
 * na criação e a community nunca volta (só `hasCommunity`).
 */

export type SdInventorySourceDTO = 'AGENT' | 'SNMP'
export type SdInventoryAlertKindDTO = 'DISK' | 'RAM'
export type SdInventoryAlertStatusDTO = 'OPEN' | 'RESOLVED'
export type SdInventoryScanStatusDTO = 'SUCCESS' | 'PARTIAL' | 'FAILED'

export interface SdInventoryDiskDTO {
  mount: string
  label: string | null
  fs: string | null
  totalMb: number
  usedMb: number
  usedPercent: number
}

export interface SdInventoryDeviceDTO {
  id: string
  source: SdInventorySourceDTO
  hostname: string
  osName: string | null
  osVersion: string | null
  arch: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  cpuModel: string | null
  cpuCores: number | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  ramUsedPercent: number | null
  ipAddresses: string[]
  macAddresses: string[]
  disks: SdInventoryDiskDTO[]
  agentVersion: string | null
  configItemId: string | null
  snmpTargetId: string | null
  firstSeenAt: string
  lastSeenAt: string
  /** Sem contato há mais que o configurado em `staleAfterDays`. */
  stale: boolean
  openAlerts: number
}

export interface SdInventorySoftwareDTO {
  id: string
  name: string
  version: string
  publisher: string | null
}

export interface SdInventoryAlertDTO {
  id: string
  deviceId: string
  hostname: string
  kind: SdInventoryAlertKindDTO
  mount: string
  status: SdInventoryAlertStatusDTO
  usedPercent: number
  threshold: number
  openedAt: string
  resolvedAt: string | null
}

export interface SdInventoryDeviceDetailDTO extends SdInventoryDeviceDTO {
  configItemName: string | null
  software: SdInventorySoftwareDTO[]
  alerts: SdInventoryAlertDTO[]
}

export interface SdInventorySoftwareCatalogRowDTO {
  name: string
  version: string
  publisher: string | null
  deviceCount: number
}

export interface SdInventorySummaryDTO {
  total: number
  agents: number
  snmp: number
  stale: number
  openAlerts: number
}

export interface SdInventorySettingsDTO {
  diskThresholdPercent: number
  ramThresholdPercent: number
  staleAfterDays: number
  syncConfigItems: boolean
  defaultTypeId: string | null
}

export interface SdInventoryTokenDTO {
  id: string
  name: string
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

/** Resposta da criação: o valor em claro aparece só aqui. */
export interface SdInventoryTokenWithValueDTO extends SdInventoryTokenDTO {
  token: string
}

export interface SdInventorySnmpTargetDTO {
  id: string
  name: string
  ranges: string[]
  port: number
  intervalMinutes: number
  active: boolean
  customerId: string | null
  hasCommunity: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: SdInventoryScanStatusDTO | null
  lastFound: number
  lastError: string | null
  createdAt: string
}

/** O que o agente recebe de volta depois do relatório. */
export interface SdInventoryIngestResultDTO {
  deviceId: string
  configItemId: string | null
  created: boolean
  openedAlerts: number
  resolvedAlerts: number
}
