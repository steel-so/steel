export type WhatsAppProviderDTO = 'ZAPI' | 'META' | 'WIDGET'

export type WhatsAppConnectionStatusDTO =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'

export interface WhatsAppConnectionDTO {
  id: string
  workspaceId: string
  provider: WhatsAppProviderDTO
  label: string
  phoneNumber: string
  status: WhatsAppConnectionStatusDTO
  statusError: string | null
  zapiInstanceId: string | null
  metaPhoneNumberId: string | null
  metaWabaId: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

// Only returned once, right after creation, so the admin can configure the
// webhook URL on the provider's dashboard. Never included in list/update responses.
export interface WhatsAppConnectionCreatedDTO extends WhatsAppConnectionDTO {
  webhookSecret: string
}
