export interface WhatsAppMetaChannelSettingsDTO {
  workspaceId: string
  coexistenceEnabled: boolean
}

/** A WhatsApp number connected through Coexistence. */
export interface MetaChannelConnectionDTO {
  id: string
  label: string
  /** Always true: only Coexistence numbers are listed. */
  coexistence: boolean
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  statusError: string | null
  createdAt: string
}

export type WhatsAppCoexistenceStatusDTO =
  | 'PENDING'
  | 'SYNCING'
  | 'COMPLETED'
  | 'DECLINED'
  | 'FAILED'

export interface WhatsAppCoexistenceSyncDTO {
  connectionId: string
  status: WhatsAppCoexistenceStatusDTO
  progress: number
  contactsImported: number
  messagesImported: number
  conversationsTouched: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}
