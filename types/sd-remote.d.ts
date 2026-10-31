/** DTOs do acesso remoto integrado (S4). Nenhuma senha trafega aqui. */

export type SdRemoteProviderDTO = 'RUSTDESK' | 'ANYDESK'

export interface SdRemoteSettingsDTO {
  enabled: boolean
  provider: SdRemoteProviderDTO
  linkTemplate: string | null
}

export interface SdRemoteEndpointDTO {
  id: string
  configItemId: string
  provider: SdRemoteProviderDTO
  remoteId: string
  source: 'MANUAL' | 'INVENTORY'
  updatedAt: string
}

export interface SdRemoteSessionDTO {
  id: string
  configItemId: string
  ticketId: string | null
  provider: SdRemoteProviderDTO
  remoteId: string
  startedAt: string
  user: { id: string; name: string }
}

/** Resposta de "Conectar": o link a abrir e o rastro gravado. */
export interface SdRemoteConnectDTO {
  sessionId: string
  provider: SdRemoteProviderDTO
  remoteId: string
  link: string
}
