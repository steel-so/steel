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
  conversationCount: number
  createdAt: string
  updatedAt: string
}
