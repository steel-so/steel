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
  conversationCount: number
  createdAt: string
  updatedAt: string
}
