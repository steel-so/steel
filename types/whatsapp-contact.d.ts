export interface WhatsAppContactDTO {
  id: string
  workspaceId: string
  waId: string
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
  createdAt: string
  updatedAt: string
}
