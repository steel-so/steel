import type { WhatsAppFlow } from '@prisma/client'
import type { WhatsAppFlowResponseWithContact } from '@/src/repositories/whatsapp-flow-response.repository'
import {
  FLOW_CATEGORIES,
  type FlowCategory,
  type FlowDefinition,
  FlowDefinitionSchema,
} from '@/src/schemas/whatsapp-flow.schema'
import type {
  WhatsAppFlowDTO,
  WhatsAppFlowListItemDTO,
  WhatsAppFlowResponseDTO,
} from '@/types/whatsapp-flow'

const EMPTY_DEFINITION: FlowDefinition = { screens: [] }

/** Reads a definition column; anything malformed reads as an empty flow. */
export function parseStoredDefinition(value: unknown): FlowDefinition {
  const parsed = FlowDefinitionSchema.safeParse(value)
  return parsed.success ? parsed.data : EMPTY_DEFINITION
}

function toCategory(value: string): FlowCategory {
  return (FLOW_CATEGORIES as readonly string[]).includes(value)
    ? (value as FlowCategory)
    : 'OTHER'
}

export function toWhatsAppFlowDTO(flow: WhatsAppFlow): WhatsAppFlowDTO {
  const definition = parseStoredDefinition(flow.definition)
  return {
    id: flow.id,
    workspaceId: flow.workspaceId,
    connectionId: flow.connectionId,
    name: flow.name,
    description: flow.description,
    category: toCategory(flow.category),
    status: flow.status,
    definition,
    bodyText: flow.bodyText,
    ctaLabel: flow.ctaLabel,
    confirmationText: flow.confirmationText,
    crmAction: flow.crmAction,
    sourceCrmFormId: flow.sourceCrmFormId,
    metaFlowId: flow.metaFlowId,
    metaStatus: flow.metaStatus,
    publishError: flow.publishError,
    publishedVersion: flow.publishedVersion,
    publishedAt: flow.publishedAt?.toISOString() ?? null,
    hasUnpublishedChanges:
      flow.publishedDefinition === null ||
      JSON.stringify(parseStoredDefinition(flow.publishedDefinition)) !==
        JSON.stringify(definition),
    sendable: flow.status !== 'DEPRECATED' && flow.metaFlowId !== null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  }
}

export function toWhatsAppFlowListItemDTO(
  flow: WhatsAppFlow,
  counts: { sent: number; completed: number },
): WhatsAppFlowListItemDTO {
  return { ...toWhatsAppFlowDTO(flow), ...counts }
}

export function toWhatsAppFlowResponseDTO(
  row: WhatsAppFlowResponseWithContact,
): WhatsAppFlowResponseDTO {
  const answers =
    row.answers &&
    typeof row.answers === 'object' &&
    !Array.isArray(row.answers)
      ? (row.answers as Record<string, unknown>)
      : null
  return {
    id: row.id,
    flowId: row.flowId,
    contactId: row.contactId,
    contactName: row.contact.name,
    contactWaId: row.contact.waId,
    conversationId: row.conversationId,
    status: row.status,
    answers,
    createdLeadId: row.createdLeadId,
    createdPersonId: row.createdPersonId,
    createdCompanyId: row.createdCompanyId,
    mappingNote: row.mappingNote,
    sentAt: row.sentAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
  }
}
