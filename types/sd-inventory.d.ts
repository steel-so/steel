/**
 * DTOs do inventário de ativos do ServiceDesk (S1). O token do agente e a
 * community SNMP **nunca** entram num DTO de leitura: o token aparece uma vez
 * na criação e a community nunca volta (só `hasCommunity`).
 */

export type SdInventorySourceDTO = 'AGENT' | 'SNMP' | 'DISCOVERY'
export type SdSnmpVersionDTO = 'V2C' | 'V3'
export type SdSnmpAuthProtocolDTO =
  | 'MD5'
  | 'SHA'
  | 'SHA224'
  | 'SHA256'
  | 'SHA384'
  | 'SHA512'
export type SdSnmpPrivProtocolDTO = 'DES' | 'AES' | 'AES256B' | 'AES256R'
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
  /** `false` = descoberto por ping/ARP, ainda sem gestão (não está na CMDB). */
  managed: boolean
  /** Ficha principal quando esta é a mesma máquina vista por outra origem. */
  mergedIntoId: string | null
  /** Depois de um "desfazer mescla" a mescla automática não repete. */
  mergeLocked: boolean
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

export interface SdInventoryMergedSourceDTO {
  id: string
  hostname: string
  source: SdInventorySourceDTO
}

export interface SdInventoryDeviceDetailDTO extends SdInventoryDeviceDTO {
  configItemName: string | null
  mergedIntoHostname: string | null
  /** Fichas de outras origens que são a mesma máquina. */
  mergedSources: SdInventoryMergedSourceDTO[]
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
  /** Descobertos por ping/ARP e ainda não adotados. */
  discovered: number
  stale: number
  openAlerts: number
}

export interface SdInventorySettingsDTO {
  diskThresholdPercent: number
  ramThresholdPercent: number
  staleAfterDays: number
  syncConfigItems: boolean
  defaultTypeId: string | null
  /** O agente consulta a versão e se atualiza sozinho. */
  agentAutoUpdate: boolean
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
  snmpVersion: SdSnmpVersionDTO
  hasCommunity: boolean
  v3Username: string | null
  v3AuthProtocol: SdSnmpAuthProtocolDTO | null
  v3PrivProtocol: SdSnmpPrivProtocolDTO | null
  hasV3AuthKey: boolean
  hasV3PrivKey: boolean
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

export interface SdInventoryDiscoveryRangeDTO {
  id: string
  name: string
  cidr: string
  enabled: boolean
  intervalMinutes: number
  customerId: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: SdInventoryScanStatusDTO | null
  lastProbed: number
  lastFound: number
  lastError: string | null
  createdAt: string
}

export interface SdInventoryAgentReleaseDTO {
  id: string
  version: string
  os: string
  arch: string
  sha256: string
  sizeBytes: number
  active: boolean
  publishedAt: string
}

/** Resposta de `GET /api/servicedesk/inventory/agent/version`. */
export interface SdInventoryAgentVersionDTO {
  updateAvailable: boolean
  version: string | null
  sha256: string | null
  size: number | null
  downloadPath: string | null
}

export interface SdInventoryAdoptResultDTO {
  deviceId: string
  configItemId: string | null
}
