import type { WhatsAppCloseOutcomeDTO } from './whatsapp-close-status'

export type WhatsAppConversationStatusDTO = 'NEW' | 'IN_PROGRESS' | 'CLOSED'

export interface WhatsAppConversationDTO {
  id: string
  workspaceId: string
  connectionId: string
  contactId: string
  contactName: string | null
  contactWaId: string
  /** Username the contact adopted on WhatsApp, when Meta reports it. */
  contactUsername: string | null
  /** False when only the BSUID is known: no calls, no phone display. */
  contactHasPhone: boolean
  contactAvatarUrl: string | null
  status: WhatsAppConversationStatusDTO
  assignedUserId: string | null
  teamId: string | null
  team: { id: string; name: string } | null
  aiActive: boolean
  aiHandoff: boolean
  unreadCount: number
  avgSentimentScore: number | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  pinned: boolean
  archived: boolean
  closedAt: string | null
  closeReason: string | null
  /** Classificação do fechamento (nula se aberta ou fechada sem status). */
  closeOutcome: WhatsAppCloseOutcomeDTO | null
  closeStatusIds: string[]
  closeStatusLabels: string[]
  contactSince: string
  createdAt: string
  updatedAt: string
}

export interface WhatsAppAssignableMemberDTO {
  id: string
  name: string
  email: string
  image: string | null
}

export type WhatsAppConversationEventKindDTO =
  | 'CLOSED'
  | 'REOPENED'
  | 'SENTIMENT_ALERT'
  | 'BUTTON_CLICKED'
  | 'ASSIGNED'
  | 'TEAM_CHANGED'
  | 'AI_GUARDRAIL_HANDOFF'
  | 'AI_ACTION'
  | 'SLA_BREACHED'
export type WhatsAppConversationEventSourceDTO =
  | 'AGENT'
  | 'CONTACT'
  | 'INACTIVITY'
  | 'SENTIMENT'
  | 'BUTTON_ACTION'
  | 'AI_GUARDRAIL'
  | 'AUTO_OUTREACH'
  | 'AI_CAMPAIGN'
  | 'AI_ACTION'
  | 'DISTRIBUTION'
  | 'SLA'

export interface WhatsAppConversationEventDTO {
  id: string
  conversationId: string
  kind: WhatsAppConversationEventKindDTO
  source: WhatsAppConversationEventSourceDTO
  actorUserId: string | null
  actorName: string | null
  reason: string | null
  /** Só em CLOSED: classificação escolhida no fechamento. */
  closeOutcome: WhatsAppCloseOutcomeDTO | null
  closeStatusLabels: string[]
  createdAt: string
}
