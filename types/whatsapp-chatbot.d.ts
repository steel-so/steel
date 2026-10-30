import type {
  ChatbotFlow,
  ChatbotStatus,
  ChatbotTrigger,
} from '@/src/schemas/whatsapp-chatbot.schema'

export type WhatsAppChatbotSessionStatusDTO =
  | 'RUNNING'
  | 'HANDED_OFF_HUMAN'
  | 'HANDED_OFF_AI'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED'

export interface WhatsAppChatbotStatsDTO {
  /** Sessions started in the last 30 days. */
  sessions: number
  running: number
  completed: number
  handedOffHuman: number
  handedOffAi: number
  expired: number
  cancelled: number
  failed: number
}

export interface WhatsAppChatbotDTO {
  id: string
  workspaceId: string
  connectionId: string | null
  name: string
  description: string | null
  status: ChatbotStatus
  triggerKind: ChatbotTrigger
  keywords: string[]
  sessionTtlMinutes: number
  /** Draft of the flow (what the editor shows). */
  flow: ChatbotFlow
  publishedVersion: number
  publishedAt: string | null
  /** The draft differs from the published flow. */
  hasUnpublishedChanges: boolean
  createdAt: string
  updatedAt: string
}

/** Entries and exits of one block over the metrics window. */
export interface WhatsAppChatbotNodeStatDTO {
  nodeId: string
  /** Times a conversation reached the block. */
  entries: number
  /** Times it moved on from the block (a valid answer or a following block). */
  exits: number
}

export interface WhatsAppChatbotNodeStatsDTO {
  /** Length of the window, in days. */
  days: number
  /** Blocks that had traffic; the others are absent (zero). */
  nodes: WhatsAppChatbotNodeStatDTO[]
}

export interface WhatsAppChatbotListItemDTO
  extends Omit<WhatsAppChatbotDTO, 'flow'> {
  nodeCount: number
  stats: WhatsAppChatbotStatsDTO
}

export interface WhatsAppChatbotSessionDTO {
  id: string
  chatbotId: string
  conversationId: string
  contactName: string | null
  contactPhone: string | null
  status: WhatsAppChatbotSessionStatusDTO
  botVersion: number
  endReason: string | null
  variables: Record<string, string>
  startedAt: string
  lastActivityAt: string
  endedAt: string | null
}

export type WhatsAppChatbotSimulationOutputDTO =
  | { kind: 'text'; text: string }
  | {
      kind: 'menu'
      nodeId: string
      text: string
      buttons: Array<{ id: string; label: string }> | null
      /** Meta interactive list for menus that do not fit reply buttons. */
      list: {
        buttonLabel: string
        rows: Array<{ id: string; label: string }>
      } | null
      numbered: string
    }

export interface WhatsAppChatbotSimulationDTO {
  /** Opaque engine state: send it back on the next step. */
  state: unknown
  outputs: WhatsAppChatbotSimulationOutputDTO[]
  status: 'WAITING' | 'COMPLETED' | 'HANDED_OFF_HUMAN' | 'HANDED_OFF_AI' | 'FAILED'
  handoff: {
    teamId?: string
    userId?: string
    instruction?: string
    reason?: string
  } | null
  closeConversation: boolean
}

export interface WhatsAppChatbotFlowIssueDTO {
  severity: 'error' | 'warning'
  nodeId?: string
  message: string
}

export interface WhatsAppChatbotPublishDTO {
  chatbot: WhatsAppChatbotDTO
  issues: WhatsAppChatbotFlowIssueDTO[]
}
