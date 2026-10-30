import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { whatsappCopilotFailed, whatsappCopilotNoContext } from '@/src/errors'
import type { AiMessage } from '@/src/lib/ai'
import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildTranscript,
  cleanCompletion,
  formatTransferSummary,
  parseSummaryResponse,
  SUMMARY_JSON_SCHEMA,
  suggestSystemPrompt,
  summarySystemPrompt,
  toneSystemPrompt,
  WHATSAPP_COPILOT_HISTORY_LIMIT,
} from '@/src/lib/whatsapp/copilot'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import type {
  AdjustWhatsAppCopilotToneDTO,
  SuggestWhatsAppCopilotReplyDTO,
} from '@/src/schemas/whatsapp-copilot.schema'
import type {
  WhatsAppCopilotRewriteDTO,
  WhatsAppCopilotSuggestionDTO,
  WhatsAppCopilotSummaryDTO,
} from '@/types/whatsapp-copilot'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { assertModuleMember } from './authz'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'

/**
 * Z7 — agent copilot. Three on-demand helpers for a human agent working a
 * conversation: suggest a reply, summarize (for a transfer) and rewrite a
 * draft in another tone. Nothing is sent or stored: the agent reviews the
 * text first. Quota and model come from the workspace AI settings (feature
 * `WHATSAPP_REPLY`, the same conversation-class model as the auto-reply).
 */

type CopilotAction = 'suggest' | 'summary' | 'tone'

async function authorizeCopilot(
  actorId: string,
  workspaceId: string,
  conversationId: string,
) {
  // Same bar as sending a message: the copilot only drafts what the agent
  // could send themselves.
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action: 'CREATE' },
  )
  if (!membership.ok) return membership
  const scope = await resolveConversationScope(
    actorId,
    workspaceId,
    membership.value.role,
  )
  if (!scope.ok) return scope
  return loadVisibleConversation(scope.value, workspaceId, conversationId)
}

async function loadTranscript(
  conversationId: string,
  clearedAt: Date | null,
): Promise<Result<string>> {
  const history = await WhatsAppMessageRepository.listLatestByConversation(
    conversationId,
    WHATSAPP_COPILOT_HISTORY_LIMIT,
  )
  if (!history.ok) return history
  const visible = clearedAt
    ? history.value.filter((message) => message.createdAt > clearedAt)
    : history.value
  const transcript = buildTranscript(visible)
  if (!transcript) return err(whatsappCopilotNoContext())
  return ok(transcript)
}

async function complete(input: {
  actorId: string
  workspaceId: string
  conversationId: string
  action: CopilotAction
  system: string
  messages: AiMessage[]
  jsonSchema?: { name: string; schema: Record<string, unknown> }
}): Promise<Result<string>> {
  const prepared = await AiUsageService.prepare(
    input.workspaceId,
    'WHATSAPP_REPLY',
    input.actorId,
  )
  if (!prepared.ok) return prepared
  const call: PreparedAiCall = prepared.value

  try {
    const response = await call.provider.chat({
      model: call.model.model,
      system: input.system,
      messages: input.messages,
      ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
    })
    await AiUsageService.record(call, {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      usage: response.usage,
      scope: { module: 'COMMUNICATION', conversationId: input.conversationId },
    })
    return ok(response.text)
  } catch (error) {
    logger.error('whatsapp.copilot.provider_failed', {
      component: 'WhatsAppCopilotService',
      action: input.action,
      conversationId: input.conversationId,
      provider: call.model.provider,
      model: call.model.model,
      reason: error instanceof Error ? error.message : String(error),
    })
    return err(whatsappCopilotFailed())
  }
}

function audit(
  actorId: string,
  conversationId: string,
  action: CopilotAction,
  via?: 'transfer',
) {
  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'update',
    actorId,
    targetId: conversationId,
    meta: { copilot: action, ...(via ? { via } : {}) },
  })
}

export type TransferSummaryOutcome =
  | { written: false; reason: 'disabled' | 'conversation_missing' }
  | { written: true }

export const WhatsAppCopilotService = {
  /**
   * Optional summary on transfer: when the workspace turned it on and a
   * conversation changes hands (another agent, another team), writes the
   * summary and pending items on the timeline as an internal event. Runs
   * after the transfer and is **never awaited by it**: a failure (quota,
   * provider, empty conversation) comes back as an `err` for the caller to
   * log, and the transfer is already done. The AI call counts against the
   * workspace quota like any other copilot call, attributed to the actor.
   */
  async summarizeOnTransfer(input: {
    actorId: string
    workspaceId: string
    conversationId: string
  }): Promise<Result<TransferSummaryOutcome>> {
    const { actorId, workspaceId, conversationId } = input
    const settings =
      await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!settings.ok) return settings
    if (!settings.value?.copilotSummaryOnTransfer) {
      return ok({ written: false, reason: 'disabled' })
    }

    const conversation = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value || conversation.value.deletedAt) {
      return ok({ written: false, reason: 'conversation_missing' })
    }

    const transcript = await loadTranscript(
      conversationId,
      conversation.value.clearedAt,
    )
    if (!transcript.ok) return transcript

    const completion = await complete({
      actorId,
      workspaceId,
      conversationId,
      action: 'summary',
      system: summarySystemPrompt(),
      messages: [{ role: 'user', content: transcript.value }],
      jsonSchema: { name: 'conversation_summary', schema: SUMMARY_JSON_SCHEMA },
    })
    if (!completion.ok) return completion

    const parsed = parseSummaryResponse(completion.value)
    if (!parsed) return err(whatsappCopilotFailed())

    const event = await WhatsAppConversationEventRepository.create({
      workspaceId,
      conversationId,
      kind: 'TRANSFER_SUMMARY',
      source: 'COPILOT',
      actorUserId: actorId,
      reason: formatTransferSummary(parsed),
    })
    if (!event.ok) return event

    audit(actorId, conversationId, 'summary', 'transfer')
    const fresh = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (fresh.ok && fresh.value) {
      await publishWhatsAppEvent(workspaceId, {
        type: 'conversation.updated',
        conversation: toWhatsAppConversationDTO(fresh.value),
      })
    }
    return ok({ written: true })
  },

  async suggestReply(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    input: SuggestWhatsAppCopilotReplyDTO,
  ): Promise<Result<WhatsAppCopilotSuggestionDTO>> {
    const conversation = await authorizeCopilot(
      actorId,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const transcript = await loadTranscript(
      conversationId,
      conversation.value.clearedAt,
    )
    if (!transcript.ok) return transcript

    const user = await UserRepository.findById(actorId)
    const completion = await complete({
      actorId,
      workspaceId,
      conversationId,
      action: 'suggest',
      system: suggestSystemPrompt({
        contactName: conversation.value.contact?.name,
        agentName: user.ok ? user.value.name : null,
        hint: input.hint,
      }),
      messages: [{ role: 'user', content: transcript.value }],
    })
    if (!completion.ok) return completion

    const text = cleanCompletion(completion.value)
    if (!text) return err(whatsappCopilotFailed())

    audit(actorId, conversationId, 'suggest')
    return ok({ text })
  },

  async summarize(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppCopilotSummaryDTO>> {
    const conversation = await authorizeCopilot(
      actorId,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const transcript = await loadTranscript(
      conversationId,
      conversation.value.clearedAt,
    )
    if (!transcript.ok) return transcript

    const completion = await complete({
      actorId,
      workspaceId,
      conversationId,
      action: 'summary',
      system: summarySystemPrompt(),
      messages: [{ role: 'user', content: transcript.value }],
      jsonSchema: { name: 'conversation_summary', schema: SUMMARY_JSON_SCHEMA },
    })
    if (!completion.ok) return completion

    const parsed = parseSummaryResponse(completion.value)
    if (!parsed) return err(whatsappCopilotFailed())

    audit(actorId, conversationId, 'summary')
    return ok(parsed)
  },

  async adjustTone(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    input: AdjustWhatsAppCopilotToneDTO,
  ): Promise<Result<WhatsAppCopilotRewriteDTO>> {
    const conversation = await authorizeCopilot(
      actorId,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const completion = await complete({
      actorId,
      workspaceId,
      conversationId,
      action: 'tone',
      system: toneSystemPrompt(input.tone),
      // The draft is the agent's own text, but fencing it keeps any
      // instruction pasted from the customer's message from being obeyed.
      messages: [
        {
          role: 'user',
          content: wrapUntrusted(input.text, 'whatsapp_message'),
        },
      ],
    })
    if (!completion.ok) return completion

    const text = cleanCompletion(completion.value)
    if (!text) return err(whatsappCopilotFailed())

    audit(actorId, conversationId, 'tone')
    return ok({ text })
  },
}
