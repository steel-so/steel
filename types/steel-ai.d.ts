/**
 * Public contract of the Steel AI assistant (API + SSE stream). Shared by
 * the backend, the `/ai` chat screen and, later, Steel Agents.
 */

import type { AiCitationDTO } from './ai-knowledge'
import type { AiMemoryRefDTO } from './ai-memory'

/**
 * UI labels: EXPLORE = Ask, AGENT = Build, AUTOPILOT = Autopilot,
 * TEST = Teste (reads run, every write is simulated — nothing changes).
 */
export type AiConversationModeDTO = 'EXPLORE' | 'AGENT' | 'AUTOPILOT' | 'TEST'

export type AiMessageRoleDTO = 'USER' | 'ASSISTANT' | 'TOOL'

export type AiActionKindDTO = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION'

export type AiPendingActionStatusDTO =
  | 'PENDING'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED'

export type AiModuleDTO = 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'

export interface AiConversationDTO {
  id: string
  title: string | null
  mode: AiConversationModeDTO
  modelKey: string | null
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
}

/** A tool call as shown in the transcript (never the raw provider payload). */
export interface AiToolCallDTO {
  id: string
  name: string
  /** pt-BR label of the tool, e.g. "Consultando chamados". */
  label: string
  module: AiModuleDTO | null
  status: 'running' | 'done' | 'error' | 'pending_confirmation' | 'simulated'
  /** Short pt-BR summary of the result, when finished. */
  summary?: string
  /** Memory tools only: the fact saved/forgotten (chip with undo). */
  memory?: AiMemoryRefDTO
  /** Teste mode: the write that would have run (nothing was changed). */
  simulation?: AiSimulatedActionDTO
  /** `steel_search` only: the sources found, linked under the answer. */
  citations?: AiCitationDTO[]
}

/** A write simulated in Teste mode, built from the tool's preview. */
export interface AiSimulatedActionDTO {
  kind: AiActionKindDTO
  preview: AiToolPreviewDTO
}

export interface AiMessageDTO {
  id: string
  conversationId: string
  /** TOOL rows are folded into the assistant message's `toolCalls`. */
  role: Exclude<AiMessageRoleDTO, 'TOOL'>
  content: string
  toolCalls: AiToolCallDTO[]
  pendingActions: AiPendingActionDTO[]
  /** Files/photos sent with a USER message (empty on ASSISTANT turns). */
  attachments: AiAttachmentDTO[]
  createdAt: string
}

export type AiAttachmentKindDTO = 'IMAGE' | 'DOCUMENT'

/** File or photo sent to Steel AI (`.../conversations/:id/attachments`). */
export interface AiAttachmentDTO {
  id: string
  conversationId: string
  /** Null until a message is sent with it. */
  messageId: string | null
  kind: AiAttachmentKindDTO
  filename: string
  contentType: string
  sizeBytes: number
  /** Same-origin URL that serves the file (thumbnail / download). */
  url: string
  createdAt: string
}

/** What the user sees before confirming a write. */
export interface AiToolPreviewDTO {
  /** pt-BR, e.g. "Excluir a oportunidade “Contrato Acme”". */
  title: string
  summary: string
  fields?: { label: string; before?: string | null; after?: string | null }[]
  target?: { type: string; id?: string; label: string; href?: string }
}

export interface AiPendingActionDTO {
  id: string
  conversationId: string | null
  agentRunId: string | null
  toolName: string
  kind: AiActionKindDTO
  module: AiModuleDTO | null
  preview: AiToolPreviewDTO
  status: AiPendingActionStatusDTO
  requiresDoubleConfirm: boolean
  /** Executed straight away in Autopilot (no confirmation was asked). */
  autoExecuted: boolean
  /** pt-BR outcome after execution (or the failure message). */
  resultSummary: string | null
  error: string | null
  expiresAt: string
  decidedAt: string | null
  executedAt: string | null
  createdAt: string
}

/**
 * Server-sent events of `POST .../ai/conversations/:id/messages`
 * (`text/event-stream`, one JSON object per `data:` line, event name = `type`).
 */
export type SteelAiStreamEvent =
  | { type: 'message.start'; conversationId: string; messageId: string }
  | { type: 'text.delta'; delta: string }
  | { type: 'tool.start'; call: AiToolCallDTO }
  | { type: 'tool.end'; call: AiToolCallDTO }
  | { type: 'action.pending'; action: AiPendingActionDTO }
  /** Autopilot: a write that already ran (EXECUTED or FAILED). */
  | { type: 'action.executed'; action: AiPendingActionDTO }
  | { type: 'conversation.title'; title: string }
  | {
      type: 'message.end'
      message: AiMessageDTO
      usage: { inputTokens: number; outputTokens: number }
    }
  | { type: 'error'; code: string; message: string }

/** A model the user may pick for a conversation (enabled + usable). */
export interface AiChatModelDTO {
  /** "<provider>:<model>". */
  key: string
  provider: 'openai' | 'anthropic'
  providerLabel: string
  label: string
  /** US$ per 1M tokens charged to the workspace (provider price × margin). */
  inputUsdPer1M: number
  outputUsdPer1M: number
}

/** `GET .../ai/capabilities` — what the chat screen may offer this user. */
export interface AiCapabilitiesDTO {
  /** Master switch: false = every other Steel AI route answers AI_DISABLED. */
  aiEnabled: boolean
  /** Workspace kill switch for the agent mode (write tools). */
  agentModeEnabled: boolean
  /** AUTOPILOT allowed (also needs `agentModeEnabled`). */
  autopilotEnabled: boolean
  /** Modules enabled in the workspace (the tools the assistant can reach). */
  modules: AiModuleDTO[]
  /**
   * Default model of a new conversation ("<provider>:<model>"): the user
   * preference, else the workspace default. Null if none is usable.
   */
  modelKey: string | null
  /** Models the picker offers, catalog order (OpenAI first). */
  models: AiChatModelDTO[]
  /** Attachment limits enforced by the server. */
  attachments: {
    maxPerMessage: number
    maxImageBytes: number
    maxDocumentBytes: number
    /** `accept` list for the file input (MIME types). */
    accept: string[]
  }
  quota: { usedUsd: number; quotaUsd: number }
}

/** One write executed by AI (assistant confirm or agent run). */
export interface AiActionLogDTO {
  id: string
  /** `MCP`: an external AI client through the MCP server (ADR 0032). */
  source: 'ASSISTANT' | 'AGENT' | 'MCP'
  actorId: string | null
  agentId: string | null
  pendingActionId: string | null
  toolName: string
  kind: AiActionKindDTO
  module: AiModuleDTO | null
  targetType: string | null
  targetId: string | null
  /** `simulated` = Teste mode / agent test run: nothing was executed. */
  outcome: 'success' | 'failure' | 'simulated'
  /** pt-BR summary of what the tool did (null on failure). */
  summary: string | null
  error: string | null
  /** OAuth client of an MCP write. */
  oauthClientId: string | null
  createdAt: string
}
