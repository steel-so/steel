/** Contacts blocked on a WhatsApp number (zap-block-contacts). */

/**
 * Where the provider stands: blocked there too, waiting for the person to
 * write (Meta's 24 h rule) or refused. The block holds in Steel either way.
 */
export type WhatsAppContactBlockStatusDTO = 'APPLIED' | 'PENDING' | 'FAILED'

/** Blocked by a member in Steel, or imported from the provider's list. */
export type WhatsAppContactBlockOriginDTO = 'STEEL' | 'PROVIDER'

export interface WhatsAppContactBlockDTO {
  id: string
  connectionId: string
  connectionLabel: string
  connectionPhoneNumber: string
  provider: 'META' | 'ZAPI' | 'WIDGET'
  contactId: string | null
  contactName: string | null
  /** Phone digits, or the BSUID of a username-only contact. */
  waId: string
  hasPhone: boolean
  reason: string | null
  providerStatus: WhatsAppContactBlockStatusDTO
  /** pt-BR reason while the status is PENDING or FAILED. */
  providerError: string | null
  appliedAt: string | null
  origin: WhatsAppContactBlockOriginDTO
  /** Messages of the contact ignored since the block. */
  droppedCount: number
  lastDroppedAt: string | null
  blockedBy: { id: string; name: string } | null
  blockedAt: string
}

/** The block of a conversation's contact on its number, for the inbox. */
export interface WhatsAppConversationBlockStateDTO {
  conversationId: string
  connectionId: string
  provider: 'META' | 'ZAPI' | 'WIDGET'
  /** False for the site chat: there is no number to block on. */
  supported: boolean
  block: WhatsAppContactBlockDTO | null
  /** Members who can answer the conversation can block it. */
  canBlock: boolean
  /** Only OWNER/ADMIN and team leaders unblock. */
  canUnblock: boolean
}

export interface WhatsAppContactBlockResultDTO {
  block: WhatsAppContactBlockDTO
  /** pt-BR summary for the toast (what happened at the provider). */
  notice: string
}

export interface WhatsAppContactUnblockResultDTO {
  id: string
  /**
   * pt-BR warning when Steel unblocked but the provider refused: the person
   * may still be blocked in the WhatsApp app / Meta.
   */
  providerWarning: string | null
}

export interface WhatsAppContactBlockSyncRowDTO {
  connectionId: string
  label: string
  provider: 'META' | 'ZAPI' | 'WIDGET'
  /** Blocks found at the provider and created in Steel. */
  imported: number
  /** PENDING/FAILED blocks sent to the provider again. */
  retried: number
  /** Of the retried, how many the provider accepted now. */
  applied: number
  /** False for Z-API: it has no endpoint that lists the block list. */
  listSupported: boolean
  /** pt-BR reason when the number could not be synced. */
  error: string | null
}

export interface WhatsAppContactBlockSyncDTO {
  connections: WhatsAppContactBlockSyncRowDTO[]
}
