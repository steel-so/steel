import type {
  AiAttachment,
  AiConversation,
  AiMessage,
  AiPendingAction,
  ModuleKind,
} from '@prisma/client'
import { readMemoryRef } from '@/src/lib/ai/context/memory-tool-names'
import {
  readCitations,
  STEEL_SEARCH_TOOL_NAME,
} from '@/src/lib/ai/knowledge/citations'
import { storedToolCalls } from '@/src/lib/ai/steel-ai-history'
import { readSimulation } from '@/src/lib/ai/tools/simulation'
import {
  ACTION_RESULT_PREFIX,
  parseToolResult,
  type ToolResultPayload,
} from '@/src/lib/ai/tools/tool-result'
import type { AiToolCall } from '@/src/lib/ai/types'
import type {
  AiConversationDTO,
  AiMessageDTO,
  AiToolCallDTO,
} from '@/types/steel-ai'
import { toAiAttachmentDTO } from './ai-attachment.mapper'
import { toAiPendingActionDTO } from './ai-pending-action.mapper'

export function toAiConversationDTO(row: AiConversation): AiConversationDTO {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    modelKey: row.modelKey,
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** pt-BR label and module of a tool, resolved by the caller (registry). */
export type AiToolMetaResolver = (name: string) => {
  label: string
  module: ModuleKind | null
}

export function toAiToolCallDTO(
  call: Pick<AiToolCall, 'id' | 'name'>,
  meta: AiToolMetaResolver,
  status: AiToolCallDTO['status'],
  summary?: string,
): AiToolCallDTO {
  const { label, module } = meta(call.name)
  return {
    id: call.id,
    name: call.name,
    label,
    module,
    status,
    ...(summary !== undefined && { summary }),
  }
}

/** Status shown in the transcript for a TOOL row's payload. */
export function toolCallStatusOf(
  payload: ToolResultPayload,
): AiToolCallDTO['status'] {
  switch (payload.status) {
    case 'pending_confirmation':
      return 'pending_confirmation'
    case 'simulated':
      return 'simulated'
    case 'error':
    case 'failed':
    case 'canceled':
      return 'error'
    default:
      return 'done'
  }
}

function summaryOf(payload: ToolResultPayload): string | undefined {
  if (payload.status === 'canceled') return 'Ação cancelada'
  return payload.summary ?? payload.error?.message
}

/**
 * Folds the raw transcript into what the chat screen shows: one USER message
 * per user row and one ASSISTANT message per turn — every ASSISTANT/TOOL row
 * until the next USER row (several tool rounds) becomes a single message
 * whose `toolCalls` carry each call's final status and whose
 * `pendingActions` are the writes proposed in that turn.
 */
export function toAiMessageDTOs(
  rows: AiMessage[],
  actions: AiPendingAction[],
  meta: AiToolMetaResolver,
  files: { workspaceId: string; attachments: AiAttachment[] } = {
    workspaceId: '',
    attachments: [],
  },
): AiMessageDTO[] {
  const result: AiMessageDTO[] = []
  const actionById = new Map(actions.map((a) => [a.id, a]))
  const filesByMessage = new Map<string, AiAttachment[]>()
  for (const file of files.attachments) {
    if (!file.messageId) continue
    const list = filesByMessage.get(file.messageId) ?? []
    list.push(file)
    filesByMessage.set(file.messageId, list)
  }
  let turn: AiMessageDTO | null = null

  const openTurn = (row: AiMessage): AiMessageDTO => {
    const created: AiMessageDTO = {
      id: row.id,
      conversationId: row.conversationId,
      role: 'ASSISTANT',
      content: '',
      toolCalls: [],
      pendingActions: [],
      attachments: [],
      createdAt: row.createdAt.toISOString(),
    }
    result.push(created)
    return created
  }

  for (const row of rows) {
    if (row.role === 'USER') {
      turn = null
      result.push({
        id: row.id,
        conversationId: row.conversationId,
        role: 'USER',
        content: row.content,
        toolCalls: [],
        pendingActions: [],
        attachments: (filesByMessage.get(row.id) ?? []).map((file) =>
          toAiAttachmentDTO(file, files.workspaceId),
        ),
        createdAt: row.createdAt.toISOString(),
      })
      continue
    }

    turn ??= openTurn(row)

    if (row.role === 'ASSISTANT') {
      if (row.content.trim()) {
        turn.content = turn.content
          ? `${turn.content}\n\n${row.content}`
          : row.content
      }
      for (const call of storedToolCalls(row.toolCalls)) {
        turn.toolCalls.push(toAiToolCallDTO(call, meta, 'running'))
      }
      continue
    }

    // TOOL row: either the result of a call, or the decision on an action.
    const payload = parseToolResult(row.content)
    let callId = row.toolCallId
    if (callId?.startsWith(ACTION_RESULT_PREFIX)) {
      const action = actionById.get(callId.slice(ACTION_RESULT_PREFIX.length))
      callId = action?.toolCallId ?? null
    }
    const call = turn.toolCalls.find((c) => c.id === callId)
    if (call) {
      call.status = toolCallStatusOf(payload)
      const summary = summaryOf(payload)
      if (summary !== undefined) call.summary = summary
      const memory = readMemoryRef(payload.data)
      if (memory) call.memory = memory
      const simulation = readSimulation(payload)
      if (simulation) call.simulation = simulation
      if (call.name === STEEL_SEARCH_TOOL_NAME && payload.status === 'done') {
        const citations = readCitations(payload.data)
        if (citations.length > 0) call.citations = citations
      }
    }
  }

  for (const message of result) {
    for (const call of message.toolCalls) {
      // A call without any result row was interrupted (provider failure).
      if (call.status === 'running') call.status = 'error'
    }
    const callIds = new Set(message.toolCalls.map((c) => c.id))
    message.pendingActions = actions
      .filter((a) => a.toolCallId && callIds.has(a.toolCallId))
      .map(toAiPendingActionDTO)
  }

  return result
}
