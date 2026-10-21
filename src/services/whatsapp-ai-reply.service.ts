import type { WhatsAppMessage } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  type AiContentPart,
  type AiMessage,
  type AiToolSpec,
  type AiUsageTokens,
  getOpenAiClient,
} from '@/src/lib/ai'
import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import {
  type AutoReplyLimitHit,
  autoReplyLimitsInstruction,
} from '@/src/lib/ai/guardrails/limits'
import { transcribeAudio } from '@/src/lib/ai/transcription'
import { ok, type Result } from '@/src/lib/result'
import {
  type AiCampaignActionRequest,
  buildAiCampaignActionTools,
  buildAiCampaignSystemSection,
  parseAiCampaignActionCall,
  selectAiCampaignActionRequests,
} from '@/src/lib/whatsapp/ai-campaign-actions'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppAiKnowledgeDocumentRepository } from '@/src/repositories/whatsapp-ai-knowledge-document.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  checkAutoReplyGuardrails,
  reportAutoReplyGuardrailHit,
} from './ai-guardrails.service'
import { AiUsageService } from './ai-usage.service'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import { WhatsAppAiCampaignService } from './whatsapp-ai-campaign.service'
import { WhatsAppAiCampaignActionService } from './whatsapp-ai-campaign-action.service'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { whatsAppTeamMemberIds } from './whatsapp-conversation-scope.service'
import {
  notifyWhatsAppUsers,
  whatsAppAdminIds,
  whatsAppConversationPath,
} from './whatsapp-notify'

const HISTORY_LIMIT = 20

// Injeção direta no prompt (sem embeddings/busca — decisão registrada no
// plano: poucos documentos por workspace no caso de uso real). Limite de
// caracteres pra não estourar o contexto do modelo com muitos documentos.
const KNOWLEDGE_BASE_CHAR_BUDGET = 20_000

// Convenção de handoff: a IA inclui esse marcador na resposta quando decide
// transferir para um humano; o service remove antes de enviar ao cliente.
// Continua marcador de texto (não tool call) — é o jeito de menor risco de
// handoff decidido pela IA sem reescrever esse fluxo já em produção. A
// consulta de agendamento abaixo, por outro lado, usa tool calling de
// verdade: o dado não cabe no prompt estático (é por contato, não por
// workspace) e precisa ser buscado sob demanda.
export const WHATSAPP_AI_HANDOFF_MARKER = '[[TRANSFERIR_ATENDENTE]]'
const HANDOFF_SYSTEM_INSTRUCTION = `\n\nSe o cliente pedir para falar com uma pessoa/atendente, ou se você não conseguir ajudar com o que ele precisa, inclua o marcador exato ${WHATSAPP_AI_HANDOFF_MARKER} em algum ponto da sua resposta — o sistema o remove automaticamente antes de enviar a mensagem.`
const HANDOFF_FALLBACK_MESSAGE =
  'Vou te transferir para um de nossos atendentes, só um momento.'

const CHECK_APPOINTMENT_TOOL_NAME = 'consultar_exame_agendado'
const CHECK_APPOINTMENT_TOOL: AiToolSpec = {
  name: CHECK_APPOINTMENT_TOOL_NAME,
  description:
    'Consulta se o cliente atual tem algum exame ou compromisso agendado, incluindo data e hora. Use sempre que o cliente perguntar se tem algo marcado, quando é o próximo exame, ou pedir para confirmar/saber o horário — não invente ou assuma uma data sem chamar essa ferramenta primeiro.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

/**
 * Resultado da resposta automática. `skipped` = não havia o que responder
 * (IA desligada, conversa fechada, cota...), `failed` = tentou e falhou no
 * provedor de IA ou no envio. Nenhum dos dois é erro do job: a conversa
 * simplesmente fica para um atendente humano.
 */
export type WhatsAppAiReplyOutcome =
  | {
      status: 'skipped'
      reason:
        | 'conversation_not_found'
        | 'ai_inactive'
        | 'conversation_closed'
        | 'ai_config_inactive'
        | 'ai_quota_exceeded'
        | 'ai_provider_unavailable'
        | 'ai_prepare_failed'
        | 'empty_completion'
        | 'contact_not_found'
        | 'outside_business_hours'
    }
  | {
      /** Outside the WhatsApp business hours: answer at `retryAt`. */
      status: 'deferred'
      retryAt: Date
    }
  | {
      status: 'failed'
      reason: 'provider_failed' | 'send_failed'
      detail: string
      provider?: string
      model?: string
    }
  | {
      status: 'sent'
      messageId: string
      handoff: boolean
      /** AI campaign actions run after the reply. */
      actions?: number
      /** The draft hit a guardrail and was replaced by the handoff (ADR 0041). */
      guardrail?: AutoReplyLimitHit['kind']
    }

interface AppointmentToolResult {
  hasAppointment: boolean
  appointmentAt?: string
  description?: string
}

async function buildKnowledgeBaseSection(workspaceId: string): Promise<string> {
  const documents =
    await WhatsAppAiKnowledgeDocumentRepository.listReadyTextsByWorkspace(
      workspaceId,
    )
  if (!documents.ok || documents.value.length === 0) return ''

  let remaining = KNOWLEDGE_BASE_CHAR_BUDGET
  const sections: string[] = []
  for (const doc of documents.value) {
    if (remaining <= 0) break
    const text = doc.extractedText.slice(0, remaining)
    // Uploaded documents are third-party content (ADR 0041): fenced as data.
    sections.push(
      `### ${doc.filename}\n${wrapUntrusted(text, 'knowledge_document')}`,
    )
    remaining -= text.length
  }

  return `\n\nBase de conhecimento (use como referência para responder; não mencione que são "documentos anexados"):\n${sections.join('\n\n')}`
}

/**
 * Auto-reply system prompt without the per-message parts (button
 * instruction, tools) — what the eval runner answers with (ADR 0039).
 */
export async function buildWhatsAppAiReplySystem(
  workspaceId: string,
  systemPrompt: string,
): Promise<string> {
  return (
    systemPrompt +
    HANDOFF_SYSTEM_INSTRUCTION +
    (await buildKnowledgeBaseSection(workspaceId))
  )
}

async function lookupUpcomingAppointment(
  contactId: string,
): Promise<AppointmentToolResult> {
  const result =
    await WhatsAppBroadcastRepository.findUpcomingAppointmentByContact(
      contactId,
    )
  if (!result.ok || !result.value?.appointmentAt) {
    return { hasAppointment: false }
  }
  return {
    hasAppointment: true,
    appointmentAt: result.value.appointmentAt.toISOString(),
    description: result.value.broadcastList.name,
  }
}

function previewForNonText(type: string): string {
  switch (type) {
    case 'IMAGE':
      return '[imagem]'
    case 'AUDIO':
      return '[áudio]'
    case 'VIDEO':
      return '[vídeo]'
    case 'DOCUMENT':
      return '[documento]'
    default:
      return '[mensagem]'
  }
}

// Transcrição usa o Whisper da OpenAI independentemente do provedor do chat
// (o Claude não transcreve áudio). Sem chave da OpenAI, cai no placeholder.
async function transcribeMediaUrl(mediaUrl: string): Promise<string | null> {
  const client = getOpenAiClient()
  if (!client) return null
  try {
    const response = await fetch(mediaUrl)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const transcription = await transcribeAudio(client, buffer, 'audio.ogg')
    return transcription?.text ?? null
  } catch (error) {
    logger.error('queue.whatsapp_ai_reply.transcription_failed', {
      component: 'WhatsappAiReply',
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Customer text is third-party content (ADR 0041): fenced as data. */
function fenceCustomerContent(
  content: string | AiContentPart[],
): string | AiContentPart[] {
  if (typeof content === 'string') {
    return wrapUntrusted(content, 'whatsapp_message')
  }
  return content.map((part) =>
    part.type === 'text'
      ? { ...part, text: wrapUntrusted(part.text, 'whatsapp_message') }
      : part,
  )
}

// Only the message that triggered this reply gets the full (costly) media
// read — older history entries stay as cheap text placeholders. Only
// customer-sent (IN) messages are eligible: past assistant image/audio
// output doesn't need re-reading to stay in context.
async function describeMessageContent(
  message: WhatsAppMessage,
  triggerMessageId: string,
  readMedia: boolean,
): Promise<string | AiContentPart[]> {
  const isTrigger = message.id === triggerMessageId
  if (
    !readMedia ||
    !isTrigger ||
    message.direction !== 'IN' ||
    !message.mediaUrl
  ) {
    return message.text ?? previewForNonText(message.type)
  }

  if (message.type === 'IMAGE') {
    return [
      { type: 'text', text: message.text || 'Imagem enviada pelo cliente' },
      { type: 'image', url: message.mediaUrl },
    ]
  }

  if (message.type === 'AUDIO') {
    const transcribed = await transcribeMediaUrl(message.mediaUrl)
    return transcribed
      ? `[áudio transcrito] ${transcribed}`
      : previewForNonText(message.type)
  }

  return message.text ?? previewForNonText(message.type)
}

function prepareFailureReason(
  code: string,
): 'ai_quota_exceeded' | 'ai_provider_unavailable' | 'ai_prepare_failed' {
  if (code === 'AI_QUOTA_EXCEEDED') return 'ai_quota_exceeded'
  if (code === 'AI_PROVIDER_UNAVAILABLE') return 'ai_provider_unavailable'
  return 'ai_prepare_failed'
}

export const WhatsAppAiReplyService = {
  /**
   * Resposta automática da IA a uma mensagem recebida. Fluxo de sistema
   * (job em background, sem usuário): não checa membership — a conversa já
   * foi aceita pelo webhook —, usa o provedor/modelo padrão do workspace e
   * respeita a cota (`AiUsageService.prepare`). Auditoria com `actorId: null`.
   */
  async generateReply(input: {
    conversationId: string
    messageId: string
    /** Button action `AI_INSTRUCTION`: answer now, following this extra
     * instruction, even when the automatic AI is off for the conversation
     * or the workspace (the click asked for it). */
    instruction?: string
  }): Promise<Result<WhatsAppAiReplyOutcome>> {
    const { conversationId, messageId, instruction } = input

    const found =
      await WhatsAppConversationRepository.findByIdWithConnection(
        conversationId,
      )
    if (!found.ok) return found
    const conversation = found.value
    if (!conversation) {
      return ok({ status: 'skipped', reason: 'conversation_not_found' })
    }
    if (!conversation.aiActive && !instruction) {
      return ok({ status: 'skipped', reason: 'ai_inactive' })
    }
    // Conversa fechada: a IA só volta a responder depois de reaberta.
    if (conversation.status === 'CLOSED') {
      return ok({ status: 'skipped', reason: 'conversation_closed' })
    }
    const workspaceId = conversation.workspaceId

    const aiConfig =
      await WhatsAppAiConfigRepository.findByWorkspace(workspaceId)
    if (!aiConfig.ok) return aiConfig
    // An AI campaign answers its own conversations even with the
    // workspace's automatic AI off (it has its own instructions/actions).
    const campaign = conversation.aiCampaignId
      ? await WhatsAppAiCampaignService.findForReply(conversation.aiCampaignId)
      : null
    if (campaign && !campaign.ok) return campaign
    const campaignContext = campaign?.ok ? campaign.value : null
    if (!aiConfig.value?.active && !instruction && !campaignContext) {
      return ok({ status: 'skipped', reason: 'ai_config_inactive' })
    }
    const config = {
      systemPrompt: aiConfig.value?.systemPrompt ?? '',
      readMedia: aiConfig.value?.readMedia ?? false,
    }

    // Business hours lock the AI too: the answer waits for the opening (a
    // window with no weekday never opens — the AI stays quiet).
    if (conversation.connection.module === 'COMMUNICATION') {
      const hours = await WhatsAppBusinessHoursService.check(workspaceId)
      if (!hours.ok) return hours
      if (!hours.value.open) {
        return ok(
          hours.value.nextOpeningAt
            ? { status: 'deferred', retryAt: hours.value.nextOpeningAt }
            : { status: 'skipped', reason: 'outside_business_hours' },
        )
      }
    }

    // Provedor/modelo = padrão do workspace para a resposta automática (job
    // em background, sem usuário). Cota esgotada ou nenhum provedor
    // disponível: não responde — a conversa fica para um atendente humano.
    const prepared = await AiUsageService.prepare(workspaceId, 'WHATSAPP_REPLY')
    if (!prepared.ok) {
      return ok({
        status: 'skipped',
        reason: prepareFailureReason(prepared.error.code),
      })
    }
    const call = prepared.value

    const history = await WhatsAppMessageRepository.listLatestByConversation(
      conversationId,
      HISTORY_LIMIT,
    )
    if (!history.ok) return history

    const orderedHistory = history.value.slice().reverse()
    const messages: AiMessage[] = await Promise.all(
      orderedHistory.map(async (message): Promise<AiMessage> => {
        const content = await describeMessageContent(
          message,
          messageId,
          config.readMedia,
        )
        // Vision content parts only ever come back for IN messages (see
        // describeMessageContent), so the 'assistant' branch is always a
        // plain string at runtime.
        return message.direction === 'IN'
          ? { role: 'user', content: fenceCustomerContent(content) }
          : { role: 'assistant', content: content as string }
      }),
    )
    const knowledgeBaseSection = await buildKnowledgeBaseSection(workspaceId)
    const system =
      config.systemPrompt +
      HANDOFF_SYSTEM_INSTRUCTION +
      (call.guardrails
        ? autoReplyLimitsInstruction(call.guardrails.limits)
        : '') +
      knowledgeBaseSection +
      (campaignContext
        ? buildAiCampaignSystemSection({
            name: campaignContext.campaign.name,
            objective: campaignContext.campaign.objective,
            instructions: campaignContext.campaign.instructions,
            actions: campaignContext.actions,
          })
        : '') +
      (instruction
        ? `\n\nInstrução para esta resposta (o cliente clicou num botão): ${instruction}`
        : '')

    const campaignActions = campaignContext?.actions ?? []
    const tools = [
      CHECK_APPOINTMENT_TOOL,
      ...buildAiCampaignActionTools(campaignActions),
    ]
    const actionRequests: AiCampaignActionRequest[] = []
    let replyText: string
    const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 }
    try {
      let response = await call.provider.chat({
        model: call.model.model,
        system,
        messages,
        tools,
      })
      usage.inputTokens += response.usage.inputTokens
      usage.outputTokens += response.usage.outputTokens

      if (response.stopReason === 'tool_use') {
        messages.push(response.message)
        for (const toolCall of response.toolCalls) {
          const actionRequest = parseAiCampaignActionCall(
            campaignActions,
            toolCall,
          )
          if (actionRequest) actionRequests.push(actionRequest)
          const toolResult =
            toolCall.name === CHECK_APPOINTMENT_TOOL_NAME
              ? await lookupUpcomingAppointment(conversation.contactId)
              : actionRequest
                ? {
                    ok: true,
                    mensagem:
                      'Ação registrada: será executada assim que sua resposta for enviada. Responda ao cliente agora.',
                  }
                : { error: `Ferramenta desconhecida: ${toolCall.name}` }
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(toolResult),
          })
        }

        // Segunda chamada com `toolChoice: 'none'`: força uma resposta final
        // em texto em vez de permitir outra rodada de tool calls (evita loop).
        response = await call.provider.chat({
          model: call.model.model,
          system,
          messages,
          tools,
          toolChoice: 'none',
        })
        usage.inputTokens += response.usage.inputTokens
        usage.outputTokens += response.usage.outputTokens
      }

      replyText = response.text.trim()
    } catch (error) {
      return ok({
        status: 'failed',
        reason: 'provider_failed',
        detail: error instanceof Error ? error.message : String(error),
        provider: call.model.provider,
        model: call.model.model,
      })
    } finally {
      await AiUsageService.record(call, { workspaceId, userId: null, usage })
    }

    const contact = await WhatsAppContactRepository.findById(
      conversation.contactId,
      workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value) {
      return ok({ status: 'skipped', reason: 'contact_not_found' })
    }

    const runCampaignActions = async (): Promise<number> => {
      const selected = selectAiCampaignActionRequests(actionRequests)
      if (!campaignContext || selected.length === 0 || !contact.value) return 0
      await WhatsAppAiCampaignActionService.run(
        {
          campaign: campaignContext.campaign,
          conversation,
          contact: contact.value,
        },
        selected,
      )
      return selected.length
    }

    if (!replyText) {
      // The AI may act without writing (e.g. close a finished conversation).
      await runCampaignActions()
      return ok({ status: 'skipped', reason: 'empty_completion' })
    }

    // Last check before the customer sees it (ADR 0041): prompt injection,
    // forbidden topic, or a promise beyond the authority limits → the draft
    // is dropped and a human takes over with the note.
    const inbound = orderedHistory.find((m) => m.id === messageId)?.text ?? ''
    const guardrail = checkAutoReplyGuardrails(call, {
      inbound,
      reply: replyText.replaceAll(WHATSAPP_AI_HANDOFF_MARKER, ''),
    })
    const shouldHandoff =
      Boolean(guardrail) || replyText.includes(WHATSAPP_AI_HANDOFF_MARKER)
    const textToSend = guardrail
      ? HANDOFF_FALLBACK_MESSAGE
      : shouldHandoff
        ? replyText.replaceAll(WHATSAPP_AI_HANDOFF_MARKER, '').trim() ||
          HANDOFF_FALLBACK_MESSAGE
        : replyText

    const sendResult = await WhatsAppSend.text(conversation.connection, {
      to: contact.value.waId,
      text: textToSend,
    })
    if (!sendResult.ok) {
      return ok({
        status: 'failed',
        reason: 'send_failed',
        detail: sendResult.error.code,
      })
    }

    const message = await WhatsAppMessageRepository.create({
      workspaceId,
      conversationId,
      direction: 'OUT',
      type: 'TEXT',
      text: textToSend,
      providerMessageId: sendResult.value.providerMessageId,
      status: 'SENT',
      sentByAi: true,
    })
    if (!message.ok) return message

    const updated = await WhatsAppConversationRepository.update(
      conversationId,
      {
        lastMessageAt: new Date(),
        ...(shouldHandoff
          ? { aiActive: false, aiHandoff: true, status: 'IN_PROGRESS' as const }
          : {}),
      },
    )
    if (!updated.ok) return updated

    if (guardrail) {
      reportAutoReplyGuardrailHit({
        workspaceId,
        feature: 'WHATSAPP_REPLY',
        kind: guardrail.kind,
        targetType: 'whatsapp_conversation',
        targetId: conversationId,
      })
      // Timeline note for whoever takes over (never sent to the contact).
      const event = await WhatsAppConversationEventRepository.create({
        workspaceId,
        conversationId,
        kind: 'AI_GUARDRAIL_HANDOFF',
        source: 'AI_GUARDRAIL',
        actorUserId: null,
        reason: guardrail.note,
      })
      if (!event.ok) {
        logger.error('queue.whatsapp_ai_reply.guardrail_event_failed', {
          component: 'WhatsappAiReply',
          workspaceId,
          conversationId,
          message: event.error.message,
        })
      }
    }

    if (shouldHandoff) {
      auditMutation({
        entity: 'whatsapp_conversation',
        action: 'update',
        actorId: null,
        targetId: conversationId,
        meta: {
          aiHandoff: true,
          trigger: guardrail ? 'guardrail' : 'ai',
          ...(guardrail && { guardrail: guardrail.kind }),
          actor: 'system',
        },
      })
      // A human must take over: the assignee, else the conversation's team
      // (Equipes), else the module admins (capped) — never every member
      // with conversation access.
      const label = contact.value.name ?? contact.value.waId
      await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_AI_HANDOFF',
        userIds: conversation.assignedUserId
          ? [conversation.assignedUserId]
          : conversation.teamId
            ? await whatsAppTeamMemberIds(workspaceId, conversation.teamId)
            : await whatsAppAdminIds(workspaceId),
        title: 'A IA transferiu uma conversa para você',
        body: guardrail
          ? `${label} precisa de um atendente. ${guardrail.note}`
          : `${label} precisa de um atendente.`,
        path: whatsAppConversationPath(conversationId),
        meta: { conversationId },
      })
      void dispatchSteelAgentEvent(workspaceId, 'zap.ai.handoff', {
        conversationId,
      })
    }

    await publishWhatsAppEvent(workspaceId, {
      type: 'message.created',
      conversationId,
      message: toWhatsAppMessageDTO(message.value),
    })

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

    // Guardrail hit: the draft was dropped, so are its actions.
    const actions = guardrail ? 0 : await runCampaignActions()

    return ok({
      status: 'sent',
      messageId: message.value.id,
      handoff: shouldHandoff,
      ...(actions > 0 && { actions }),
      ...(guardrail && { guardrail: guardrail.kind }),
    })
  },
}
