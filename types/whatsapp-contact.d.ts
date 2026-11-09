export interface WhatsAppContactDTO {
  id: string
  workspaceId: string
  /** Phone (digits) or, for a username-only contact, its BSUID. */
  waId: string
  username: string | null
  /** False when only the BSUID is known. */
  hasPhone: boolean
  name: string | null
  avatarUrl: string | null
  description: string | null
  /** Opt-out LGPD de transmissões — ISO quando descadastrado, senão null. */
  broadcastOptedOutAt: string | null
  broadcastOptOutSource: 'KEYWORD' | 'ADMIN' | 'AI' | null
  /** "Tem zap?" (Z-API): true/false = resultado, null = não verificado. */
  hasWhatsapp: boolean | null
  whatsappCheckedAt: string | null
  conversationCount: number
  /** `definitionId -> value` of the workspace's contact fields (list/update). */
  customFields?: Record<string, string | number | boolean | null>
  createdAt: string
  updatedAt: string
}

/** A custom field a workspace defined on its WhatsApp contacts. */
export interface WhatsAppContactFieldDTO {
  id: string
  key: string
  label: string
  type:
    | 'TEXT'
    | 'NUMBER'
    | 'DATE'
    | 'BOOLEAN'
    | 'SELECT'
    | 'CPF'
    | 'CNPJ'
    | 'EMAIL'
    | 'PHONE'
    | 'URL'
    | 'CEP'
  options: string[]
  required: boolean
  position: number
}
