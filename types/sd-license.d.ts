/** DTOs da gestão de licenças de software do ServiceDesk (S7). */

export type SdLicenseStatusDTO =
  | 'EXPIRED'
  | 'UNDER_LICENSED'
  | 'EXPIRING'
  | 'OVER_LICENSED'
  | 'COMPLIANT'
export type SdLicenseFitDTO = 'UNDER_LICENSED' | 'OVER_LICENSED' | 'COMPLIANT'
export type SdLicenseExpiryStateDTO = 'NONE' | 'OK' | 'EXPIRING' | 'EXPIRED'

export interface SdLicenseDTO {
  id: string
  name: string
  vendor: string | null
  matchPattern: string
  seats: number
  unitCostCents: number | null
  /** `YYYY-MM-DD`. */
  purchasedAt: string | null
  /** `YYYY-MM-DD`. */
  expiresAt: string | null
  renewalNoticeDays: number
  notes: string | null
  archived: boolean
  assetCount: number
  installed: number
  /** Positivo = sobrando; negativo = faltando. */
  balance: number
  fit: SdLicenseFitDTO
  expiryState: SdLicenseExpiryStateDTO
  daysLeft: number | null
  status: SdLicenseStatusDTO
  createdAt: string
  updatedAt: string
}

export interface SdLicenseAssetDTO {
  configItemId: string
  name: string
  code: string | null
}

export interface SdLicenseInstalledDeviceDTO {
  deviceId: string
  hostname: string
  configItemId: string | null
  configItemName: string | null
  softwareName: string
  softwareVersion: string
  /** Coberto por um ativo atribuído à licença. */
  assigned: boolean
}

export interface SdLicenseDetailDTO extends SdLicenseDTO {
  assets: SdLicenseAssetDTO[]
  /** Equipamentos com o software instalado (até 200). */
  devices: SdLicenseInstalledDeviceDTO[]
  /** Instalado e sem licença atribuída. */
  unassignedCount: number
}

export interface SdLicenseSummaryDTO {
  total: number
  compliant: number
  underLicensed: number
  overLicensed: number
  expiring: number
  expired: number
  /** Licenças que faltam (soma dos saldos negativos, em módulo). */
  shortfallSeats: number
  /** Licenças sobrando. */
  surplusSeats: number
  /** Custo das licenças sobrando, quando há custo unitário (centavos). */
  surplusCostCents: number
}

export interface SdLicenseListDTO {
  items: SdLicenseDTO[]
  summary: SdLicenseSummaryDTO
}

/** Licenças atribuídas a um ativo da CMDB. */
export interface SdConfigItemLicenseDTO {
  id: string
  name: string
  vendor: string | null
  expiresAt: string | null
  daysLeft: number | null
  expiryState: SdLicenseExpiryStateDTO
}
