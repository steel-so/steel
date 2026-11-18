export type PlatformZapiLineStatusDTO =
  | 'DISCONNECTED'
  | 'AWAITING_QR'
  | 'CONNECTED'
  | 'ERROR'

/**
 * The platform verification line as the admin screen sees it. Tokens never
 * leave the server: only the masked instance id and the connection state.
 */
export interface PlatformZapiLineDTO {
  /** False until credentials are saved; every other field is then empty. */
  configured: boolean
  /** Instance id with its middle masked (e.g. `3C4A****91F2`). */
  instanceIdMasked: string | null
  hasClientToken: boolean
  label: string | null
  /** Digits of the paired WhatsApp number, once connected. */
  phone: string | null
  status: PlatformZapiLineStatusDTO | null
  statusError: string | null
  connectedAt: string | null
  statusCheckedAt: string | null
  updatedAt: string | null
}

export interface PlatformZapiLineQrCodeDTO {
  status: 'connected' | 'awaiting_scan'
  /** `data:` URL (or base64) of the QR image; present while awaiting scan. */
  qrCodeBase64?: string
  line: PlatformZapiLineDTO
}
