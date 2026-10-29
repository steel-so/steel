import type {
  FlowCategory,
  FlowCrmAction,
  FlowDefinition,
} from '@/src/schemas/whatsapp-flow.schema'

export type WhatsAppFlowStatusDTO = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'

export interface WhatsAppFlowDTO {
  id: string
  workspaceId: string
  connectionId: string
  name: string
  description: string | null
  category: FlowCategory
  status: WhatsAppFlowStatusDTO
  definition: FlowDefinition
  bodyText: string
  ctaLabel: string
  confirmationText: string | null
  crmAction: FlowCrmAction
  sourceCrmFormId: string | null
  metaFlowId: string | null
  metaStatus: string | null
  publishError: string | null
  publishedVersion: number
  publishedAt: string | null
  /** The editor holds changes Meta does not have yet. */
  hasUnpublishedChanges: boolean
  /** The flow can be sent (published, or uploaded as a Meta draft). */
  sendable: boolean
  createdAt: string
  updatedAt: string
}

export interface WhatsAppFlowListItemDTO extends WhatsAppFlowDTO {
  sent: number
  completed: number
}

export interface WhatsAppFlowResponseDTO {
  id: string
  flowId: string
  contactId: string
  contactName: string | null
  contactWaId: string
  conversationId: string | null
  status: 'SENT' | 'COMPLETED'
  answers: Record<string, unknown> | null
  createdLeadId: string | null
  createdPersonId: string | null
  createdCompanyId: string | null
  mappingNote: string | null
  sentAt: string
  respondedAt: string | null
}

export interface WhatsAppFlowResponsesPageDTO {
  items: WhatsAppFlowResponseDTO[]
  nextCursor: string | null
}

export interface WhatsAppFlowPublishDTO {
  flow: WhatsAppFlowDTO
  published: boolean
}

export interface WhatsAppFlowMetaJsonDTO {
  json: Record<string, unknown>
}

export interface WhatsAppFlowPreviewDTO {
  previewUrl: string | null
  status: string
}

export interface WhatsAppFlowSendDTO {
  messageId: string
  responseId: string
}
