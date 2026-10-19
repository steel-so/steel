import type {
  AiUsageFeature,
  Prisma,
  SdAiConversation,
  SdSettings,
  SdTicketType,
  WhatsAppMessage,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  aiProviderUnavailable,
  sdAiConversationClosed,
  sdAiConversationNotFound,
  sdAiDisabled,
  sdPortalDisabled,
  sdTicketForbidden,
} from '@/src/errors'
import type { AiChatRequest, AiChatResponse, AiMessage } from '@/src/lib/ai'
import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import {
  type AutoReplyLimitHit,
  autoReplyLimitsInstruction,
} from '@/src/lib/ai/guardrails/limits'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildSdCopilotSystem,
  buildSdPreServiceSystem,
  buildSdTriageSystem,
  clipSdText,
  formatSdKbContext,
  formatSdTicketContext,
  redactSdPii,
  SD_AI_LOW_CONFIDENCE,
  type SdAiAuthorRole,
  type SdAiCatalog,
  type SdCopilotTask,
  sdAiSearchTerms,
  sdAiTranscript,
  sdHandoffRequested,
} from '@/src/lib/servicedesk/ai-prompts'
import { sdHtmlToText } from '@/src/lib/servicedesk/html'
import {
  sdPlainTextToHtml,
  sdWhatsappMessageBody,
} from '@/src/lib/servicedesk/whatsapp'
import {
  parseSdAiMessages,
  toSdAiClassification,
  toSdAiConversationDTO,
} from '@/src/mappers/sd-ai.mapper'
import { SdAiRepository } from '@/src/repositories/sd-ai.repository'
import {
  SdKbArticleRepository,
  type SdKbSearchRow,
} from '@/src/repositories/sd-kb-article.repository'
import {
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import {
  type SdWaConversation,
  SdWhatsappRepository,
} from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  parseSdAiJson,
  SD_AI_TRIAGE_JSON_SCHEMA,
  SD_AI_TURN_JSON_SCHEMA,
  type SdAiChatMessageDTO,
  type SdAiPreServiceCloseDTO,
  type SdAiPreServiceMessageDTO,
  type SdAiPreServiceOpenTicketDTO,
  type SdAiReplyRequestDTO,
  SdAiTriageOutputSchema,
  type SdAiTurnOutput,
  SdAiTurnOutputSchema,
} from '@/src/schemas/sd-ai.schema'
import type {
  SdAiArticleCardDTO,
  SdAiClassificationDTO,
  SdAiConversationDTO,
  SdAiMessageDTO,
  SdAiOpenedTicketDTO,
  SdAiPreServiceReplyDTO,
  SdAiTextDTO,
  SdAiTicketDraftDTO,
  SdAiTriageRecordDTO,
} from '@/types/sd-ai'
import {
  checkAutoReplyGuardrails,
  reportAutoReplyGuardrailHit,
} from './ai-guardrails.service'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { SdAccess, type SdAccessContext } from './sd-access'
import { fireSdAutomations } from './sd-automation-engine'
import { sdKbTermsFromTitle } from './sd-kb-ticket-link.service'
import {
  type SdEngineChanges,
  type SdEngineConfig,
  SdTicketEngine,
  sdSystemActor,
  sdTicketCode,
  sdUserActor,
} from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import {
  mirrorSdWhatsappMessage,
  publishSdTicketMessage,
  SdWhatsappInboundService,
  sendSdWhatsappText,
} from './sd-whatsapp-inbound.service'

/**
 * Agente de IA do ServiceDesk (ADR 0007 + 0008): copiloto do agente,
 * triagem automática e pré-atendimento do solicitante (portal e WhatsApp).
 *
 * Toda chamada passa por `AiUsageService.prepare` (provedor/modelo do
 * workspace + cota mensal → `AI_QUOTA_EXCEEDED`) e respeita
 * `SdSettings.aiEnabled` (`SD_AI_DISABLED`). LGPD: o contexto enviado é só
 * texto do chamado/mensagens/base, com dados pessoais mascarados
 * (`src/lib/servicedesk/ai-prompts.ts`).
 */

const TYPE_LABEL: Record<SdTicketType, string> = {
  INCIDENT: 'Incidente',
  SERVICE_REQUEST: 'Requisição',
  CHANGE: 'Mudança',
  PROBLEM: 'Problema',
}

const ROLE_BY_AUTHOR: Record<string, SdAiAuthorRole> = {
  AGENT: 'agente',
  REQUESTER: 'solicitante',
  CONTACT: 'contato',
  AI: 'ia',
  SYSTEM: 'sistema',
}

const COPILOT_HISTORY = 20
const PRE_SERVICE_HISTORY = 16
const KB_LIMIT = 4
const HANDOFF_REPLY =
  'Certo! Vou encaminhar para o nosso time de atendimento. Você pode abrir o chamado agora com o resumo da nossa conversa.'
/** Sent instead of a draft that hit a guardrail (ADR 0041). */
const GUARDRAIL_HANDOFF_REPLY =
  'Esse assunto precisa de um atendente. Vou encaminhar para o nosso time, e ele continua por aqui.'
const PROVIDER_FAILED =
  'Não foi possível falar com o provedor de IA agora. Tente novamente em instantes.'

/* ------------------------------------------------------------------ */
/* Infra de chamada                                                     */
/* ------------------------------------------------------------------ */

async function prepareCall(
  settings: Pick<SdSettings, 'aiEnabled'>,
  workspaceId: string,
  feature: AiUsageFeature,
  userId: string | null,
): Promise<Result<PreparedAiCall>> {
  if (!settings.aiEnabled) return err(sdAiDisabled())
  return AiUsageService.prepare(workspaceId, feature, userId)
}

/** Uma chamada ao provedor; o consumo vai para a cota mesmo sem resposta útil. */
async function complete(
  call: PreparedAiCall,
  request: Omit<AiChatRequest, 'model'>,
  workspaceId: string,
  userId: string | null,
): Promise<Result<AiChatResponse>> {
  try {
    const response = await call.provider.chat({
      ...request,
      model: call.model.model,
    })
    await AiUsageService.record(call, {
      workspaceId,
      userId,
      usage: response.usage,
    })
    return ok(response)
  } catch (error) {
    logger.error('servicedesk.ai.provider_failed', {
      workspaceId,
      feature: call.feature,
      provider: call.model.provider,
      model: call.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(aiProviderUnavailable(PROVIDER_FAILED))
  }
}

function now(): string {
  return new Date().toISOString()
}

function toCards(rows: SdKbSearchRow[], ids: string[]): SdAiArticleCardDTO[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return [...new Set(ids)].flatMap((id) => {
    const row = byId.get(id)
    return row
      ? [
          {
            id: row.id,
            title: row.title,
            excerpt: clipSdText(row.plainText, 240),
          },
        ]
      : []
  })
}

/* ------------------------------------------------------------------ */
/* Copiloto (agentes)                                                   */
/* ------------------------------------------------------------------ */

interface AgentTicket {
  ctx: SdAccessContext
  config: SdEngineConfig
  ticket: SdTicketWithRelations
}

async function agentTicket(
  actorId: string,
  workspaceId: string,
  ticketRef: string,
  action: 'VIEW' | 'EDIT' = 'VIEW',
): Promise<Result<AgentTicket>> {
  const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action,
  })
  if (!ctx.ok) return ctx
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) return config
  if (!config.value.settings.aiEnabled) return err(sdAiDisabled())
  const ticket = await SdTicketEngine.resolveRef(
    workspaceId,
    ticketRef,
    config.value.prefixes,
  )
  if (!ticket.ok) return ticket
  return ok({ ctx: ctx.value, config: config.value, ticket: ticket.value })
}

async function ticketContext(
  ticket: SdTicketWithRelations,
  config: SdEngineConfig,
): Promise<Result<{ ticket: string; kb: string }>> {
  const messages = await SdAiRepository.listTicketMessages(ticket.id)
  if (!messages.ok) return messages
  const kb = await SdKbArticleRepository.suggest(ticket.workspaceId, {
    terms: sdKbTermsFromTitle(ticket.title),
    categoryIds: [
      ticket.categoryId,
      ticket.subcategoryId,
      ticket.serviceId,
    ].filter((id): id is string => Boolean(id)),
    limit: KB_LIMIT,
    portalOnly: false,
  })
  if (!kb.ok) return kb
  const catalog = [ticket.category, ticket.subcategory, ticket.service]
    .filter((n): n is { id: string; name: string } => Boolean(n))
    .map((n) => n.name)
    .join(' > ')
  return ok({
    ticket: formatSdTicketContext({
      code: sdTicketCode(ticket, config.prefixes),
      type: TYPE_LABEL[ticket.type],
      title: ticket.title,
      description: sdHtmlToText(ticket.description ?? ''),
      phase: ticket.phase.name,
      priority: ticket.priority?.name ?? null,
      category: catalog || null,
      department: ticket.department?.name ?? null,
      solution: ticket.solution,
      messages: messages.value.map((m) => ({
        role: ROLE_BY_AUTHOR[m.authorKind] ?? 'sistema',
        internal: m.visibility === 'INTERNAL',
        body: m.body,
        at: m.createdAt.toISOString(),
      })),
    }),
    kb: formatSdKbContext(kb.value),
  })
}

async function copilotText(
  actorId: string,
  workspaceId: string,
  ticketRef: string,
  task: Exclude<SdCopilotTask, 'chat'>,
  extra?: string,
): Promise<Result<{ text: string; loaded: AgentTicket }>> {
  const loaded = await agentTicket(
    actorId,
    workspaceId,
    ticketRef,
    task === 'summary' ? 'EDIT' : 'VIEW',
  )
  if (!loaded.ok) return loaded
  const { config, ticket } = loaded.value
  const call = await prepareCall(
    config.settings,
    workspaceId,
    'SERVICEDESK_COPILOT',
    actorId,
  )
  if (!call.ok) return call
  const context = await ticketContext(ticket, config)
  if (!context.ok) return context
  const response = await complete(
    call.value,
    {
      system: buildSdCopilotSystem(task, config.settings, context.value),
      messages: [
        {
          role: 'user',
          content: extra
            ? `Orientação do agente: ${redactSdPii(extra)}`
            : 'Gere agora.',
        },
      ],
      maxTokens: 1200,
    },
    workspaceId,
    actorId,
  )
  if (!response.ok) return response
  const text = response.value.text.trim()
  if (!text) return err(aiProviderUnavailable(PROVIDER_FAILED))
  logger.info('servicedesk.ai.copilot', {
    workspaceId,
    ticketId: ticket.id,
    task,
    model: call.value.model.key,
  })
  return ok({ text, loaded: loaded.value })
}

/* ------------------------------------------------------------------ */
/* Turno do assistente (pré-atendimento e resposta automática)          */
/* ------------------------------------------------------------------ */

interface TurnInput {
  workspaceId: string
  settings: SdSettings
  userId: string | null
  channel: 'portal' | 'whatsapp'
  history: { role: 'user' | 'assistant'; content: string }[]
  /** Solicitante/contato: só artigos publicados no portal. */
  portalOnly: boolean
  ticketOpen?: { code: string; title: string } | null
}

interface TurnResult {
  output: SdAiTurnOutput
  articles: SdAiArticleCardDTO[]
  draft: SdAiTicketDraftDTO
  /** The draft hit a guardrail and was replaced by a handoff (ADR 0041). */
  guardrail?: AutoReplyLimitHit
}

function allowedTypes(
  settings: SdSettings,
  portalOnly: boolean,
): SdTicketType[] {
  if (!portalOnly) return ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM']
  return settings.portalTicketTypes.length > 0
    ? settings.portalTicketTypes
    : ['INCIDENT']
}

/** Rascunho do chamado: o da IA com ids validados contra o catálogo. */
function normalizeDraft(
  raw: SdAiTurnOutput['ticket'],
  catalog: Pick<SdAiCatalog, 'categories' | 'urgencies'>,
  types: SdTicketType[],
  history: TurnInput['history'],
): SdAiTicketDraftDTO {
  const userTexts = history
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
  const firstLine = (userTexts[0] ?? '').split('\n')[0]?.trim() ?? ''
  const categories = new Map(catalog.categories.map((c) => [c.id, c]))
  const category = raw?.categoryId ? categories.get(raw.categoryId) : undefined
  const validCategory = category?.level === 'CATEGORY' ? category : undefined
  const sub = raw?.subcategoryId ? categories.get(raw.subcategoryId) : undefined
  const validSub =
    validCategory &&
    sub?.level === 'SUBCATEGORY' &&
    sub.parentId === validCategory.id
      ? sub
      : undefined
  const service = raw?.serviceId ? categories.get(raw.serviceId) : undefined
  const validService =
    validSub && service?.level === 'SERVICE' && service.parentId === validSub.id
      ? service
      : undefined
  const urgency = raw?.urgencyId
    ? catalog.urgencies.find((u) => u.id === raw.urgencyId)
    : undefined
  const type = raw?.type && types.includes(raw.type) ? raw.type : types[0]
  return {
    title:
      raw?.title && raw.title.length >= 3
        ? raw.title.slice(0, 200)
        : clipSdText(firstLine || 'Solicitação via assistente', 120),
    description: raw?.description || userTexts.join('\n\n'),
    type,
    categoryId: validCategory?.id ?? null,
    subcategoryId: validSub?.id ?? null,
    serviceId: validService?.id ?? null,
    urgencyId: urgency?.id ?? null,
  }
}

async function assistantTurn(input: TurnInput): Promise<Result<TurnResult>> {
  const call = await prepareCall(
    input.settings,
    input.workspaceId,
    'SERVICEDESK_PRE_SERVICE',
    input.userId,
  )
  if (!call.ok) return call

  const userTexts = input.history
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
  const [kb, catalog] = await Promise.all([
    SdKbArticleRepository.suggest(input.workspaceId, {
      terms: sdAiSearchTerms(userTexts),
      categoryIds: [],
      limit: KB_LIMIT,
      portalOnly: input.portalOnly,
    }),
    SdAiRepository.loadCatalog(input.workspaceId, { portalOnly: true }),
  ])
  if (!kb.ok) return kb
  if (!catalog.ok) return catalog

  const types = allowedTypes(input.settings, input.portalOnly)
  // Requester text is third-party content (ADR 0041): fenced as data.
  const source =
    input.channel === 'portal' ? 'portal_message' : 'whatsapp_message'
  const messages: AiMessage[] = input.history
    .slice(-PRE_SERVICE_HISTORY)
    .map((m) =>
      m.role === 'user'
        ? {
            role: 'user',
            content: wrapUntrusted(redactSdPii(m.content), source),
          }
        : { role: 'assistant', content: m.content },
    )
  const limits = call.value.guardrails?.limits
  const response = await complete(
    call.value,
    {
      system:
        buildSdPreServiceSystem({
          aiPersona: input.settings.aiPersona,
          aiInstructions: input.settings.aiInstructions,
          channel: input.channel,
          ticketTypes: types,
          catalog: catalog.value,
          kb: formatSdKbContext(kb.value),
          ticketOpen: input.ticketOpen,
        }) + (limits ? autoReplyLimitsInstruction(limits) : ''),
      messages,
      jsonSchema: { name: 'sd_assistant_turn', schema: SD_AI_TURN_JSON_SCHEMA },
      maxTokens: 1500,
    },
    input.workspaceId,
    input.userId,
  )
  if (!response.ok) return response

  const output: SdAiTurnOutput = parseSdAiJson(
    SdAiTurnOutputSchema,
    response.value.text,
  ) ?? {
    reply: response.value.text.trim() || HANDOFF_REPLY,
    action: response.value.text.trim() ? 'answer' : 'open_ticket',
    articleIds: [],
    confidence: 0.5,
    ticket: null,
  }
  const draft = normalizeDraft(
    output.ticket,
    catalog.value,
    types,
    input.history,
  )
  const hit = checkAutoReplyGuardrails(call.value, {
    inbound: userTexts.at(-1) ?? '',
    reply: output.reply,
  })
  if (hit) {
    // The draft never reaches the requester: a human takes over.
    return ok({
      output: {
        ...output,
        reply: GUARDRAIL_HANDOFF_REPLY,
        action: 'open_ticket',
        articleIds: [],
        confidence: 1,
      },
      articles: [],
      draft,
      guardrail: hit,
    })
  }
  return ok({
    output,
    articles: toCards(kb.value, output.articleIds),
    draft,
  })
}

function shouldOpenTicket(output: SdAiTurnOutput): boolean {
  return (
    output.action === 'open_ticket' ||
    (output.action === 'answer' && output.confidence < SD_AI_LOW_CONFIDENCE)
  )
}

function storedMessages(history: SdAiMessageDTO[]): Prisma.InputJsonValue {
  return history as unknown as Prisma.InputJsonValue
}

/* ------------------------------------------------------------------ */
/* Pré-atendimento (portal)                                             */
/* ------------------------------------------------------------------ */

interface PreServiceLoaded {
  ctx: SdAccessContext
  config: SdEngineConfig
}

async function preServiceAccess(
  actorId: string,
  workspaceId: string,
): Promise<Result<PreServiceLoaded>> {
  const ctx = await SdAccess.resolve(actorId, workspaceId)
  if (!ctx.ok) return ctx
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) return config
  const { settings } = config.value
  if (!settings.aiEnabled || !settings.aiPreServiceEnabled) {
    return err(sdAiDisabled('O pré-atendimento por IA está desativado'))
  }
  if (!ctx.value.isAgent && !settings.portalEnabled) {
    return err(sdPortalDisabled())
  }
  return ok({ ctx: ctx.value, config: config.value })
}

async function ownPreService(
  actorId: string,
  workspaceId: string,
  conversationId: string,
): Promise<Result<SdAiConversation>> {
  const found = await SdAiRepository.findConversation(
    conversationId,
    workspaceId,
  )
  if (!found.ok) return found
  const row = found.value
  if (
    row?.mode !== 'PRE_SERVICE' ||
    row.userId !== actorId ||
    row.whatsappConversationId
  ) {
    return err(sdAiConversationNotFound())
  }
  if (row.outcome) return err(sdAiConversationClosed())
  return ok(row)
}

/** Último rascunho guardado nas mensagens do assistente. */
function lastDraft(raw: unknown): SdAiTicketDraftDTO | null {
  if (!Array.isArray(raw)) return null
  for (let i = raw.length - 1; i >= 0; i--) {
    const item = raw[i] as { role?: unknown; draft?: SdAiTicketDraftDTO }
    if (item?.role === 'assistant' && item.draft) return item.draft
  }
  return null
}

const CATALOG_ERRORS = new Set([
  'SD_CATEGORY_NOT_FOUND',
  'SD_CATEGORY_LEVEL_INVALID',
  'SD_CONFIG_NOT_FOUND',
])

/* ------------------------------------------------------------------ */
/* WhatsApp (jobs)                                                      */
/* ------------------------------------------------------------------ */

export type SdAiWhatsappOutcome =
  | {
      status: 'skipped'
      reason:
        | 'conversation_not_found'
        | 'message_not_found'
        | 'ai_disabled'
        | 'human_handling'
        | 'ticket_already_open'
    }
  | { status: 'replied'; action: SdAiTurnOutput['action'] }
  | { status: 'handoff' }
  | { status: 'ticket_opened'; ticketId: string; reason: string }
  | { status: 'failed'; reason: string }

export type SdAiTriageOutcome =
  | {
      status: 'skipped'
      reason:
        | 'ticket_not_found'
        | 'ai_disabled'
        | 'already_triaged'
        | 'unparseable_response'
        | 'ai_quota_exceeded'
        | 'ai_provider_unavailable'
        | 'ai_prepare_failed'
    }
  | { status: 'failed'; reason: 'provider_failed' }
  | { status: 'triaged'; applied: string[]; confidence: number }

function prepareFailure(code: string) {
  if (code === 'AI_QUOTA_EXCEEDED') return 'ai_quota_exceeded' as const
  if (code === 'AI_PROVIDER_UNAVAILABLE')
    return 'ai_provider_unavailable' as const
  return 'ai_prepare_failed' as const
}

function waContent(message: WhatsAppMessage): string {
  return sdWhatsappMessageBody(message.type, message.text)
}

async function openFromPreService(input: {
  conversation: SdWaConversation
  config: SdEngineConfig
  aiConversation: SdAiConversation
  history: SdAiMessageDTO[]
  draft: SdAiTicketDraftDTO | null
  reason: string
  /** Guardrail note for the agent who takes over (ADR 0041). */
  note?: string
}): Promise<Result<SdAiWhatsappOutcome>> {
  const opened = await SdWhatsappInboundService.openTicketFromWhatsapp({
    connection: input.conversation.connection,
    conversationId: input.conversation.id,
    contact: input.conversation.contact,
    config: input.config,
    draft: input.draft,
    transcript: sdAiTranscript(input.history),
  })
  if (!opened.ok) return opened
  const saved = await SdAiRepository.updateConversation(
    input.aiConversation.id,
    {
      messages: storedMessages(input.history),
      outcome: 'ticket_opened',
      ticketId: opened.value.id,
    },
  )
  if (!saved.ok) return saved
  await WhatsAppConversationRepository.update(input.conversation.id, {
    aiActive: false,
  })
  await recordSdTicketEvent({
    workspaceId: opened.value.workspaceId,
    ticketId: opened.value.id,
    actorKind: 'AI',
    action: 'ai.pre_service',
    meta: {
      conversationId: input.aiConversation.id,
      channel: 'WHATSAPP',
      reason: input.reason,
      ...(input.note && { note: input.note }),
    },
  })
  return ok({
    status: 'ticket_opened',
    ticketId: opened.value.id,
    reason: input.reason,
  })
}

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

export const SdAiService = {
  /* ---------------------------- copiloto ---------------------------- */

  /** Resume o chamado e grava em `aiSummary`. */
  async summarize(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdAiTextDTO>> {
    const result = await copilotText(actorId, workspaceId, ticketRef, 'summary')
    if (!result.ok) return result
    const { ticket } = result.value.loaded
    const saved = await SdAiRepository.setTicketAi(ticket.id, {
      aiSummary: result.value.text,
    })
    if (!saved.ok) return saved
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: 'AGENT',
      actorUserId: actorId,
      action: 'ai.summary',
    })
    auditMutation({
      entity: 'sd_ticket',
      action: 'update',
      actorId,
      targetId: ticket.id,
      meta: { workspaceId },
    })
    return ok({ text: result.value.text })
  },

  /** Sugestão da próxima resposta pública (o agente revisa e envia). */
  async suggestReply(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdAiReplyRequestDTO = {},
  ): Promise<Result<SdAiTextDTO>> {
    const result = await copilotText(
      actorId,
      workspaceId,
      ticketRef,
      'reply',
      dto.instructions,
    )
    if (!result.ok) return result
    return ok({ text: result.value.text })
  },

  /** Rascunho do campo "Solução". */
  async draftSolution(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdAiTextDTO>> {
    const result = await copilotText(
      actorId,
      workspaceId,
      ticketRef,
      'solution',
    )
    if (!result.ok) return result
    return ok({ text: result.value.text })
  },

  /**
   * Sugestão de classificação (catálogo, impacto/urgência/prioridade,
   * departamento, tags). Só sugere — o agente aplica pela rota de chamados.
   */
  async suggestClassification(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdAiClassificationDTO>> {
    const loaded = await agentTicket(actorId, workspaceId, ticketRef)
    if (!loaded.ok) return loaded
    const { config, ticket } = loaded.value
    const call = await prepareCall(
      config.settings,
      workspaceId,
      'SERVICEDESK_COPILOT',
      actorId,
    )
    if (!call.ok) return call
    const catalog = await SdAiRepository.loadCatalog(workspaceId, {
      type: ticket.type,
    })
    if (!catalog.ok) return catalog
    const response = await complete(
      call.value,
      {
        system: buildSdTriageSystem(catalog.value),
        messages: [{ role: 'user', content: triageInput(ticket) }],
        jsonSchema: { name: 'sd_triage', schema: SD_AI_TRIAGE_JSON_SCHEMA },
        maxTokens: 800,
      },
      workspaceId,
      actorId,
    )
    if (!response.ok) return response
    const output = parseSdAiJson(SdAiTriageOutputSchema, response.value.text)
    if (!output) return err(aiProviderUnavailable(PROVIDER_FAILED))
    return ok(toSdAiClassification(output, catalog.value))
  },

  /** Conversa do copiloto do agente neste chamado (`null` = nenhuma). */
  async getChat(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdAiConversationDTO | null>> {
    const loaded = await agentTicket(actorId, workspaceId, ticketRef)
    if (!loaded.ok) return loaded
    const found = await SdAiRepository.findCopilotConversation(
      workspaceId,
      loaded.value.ticket.id,
      actorId,
    )
    if (!found.ok) return found
    return ok(found.value ? toSdAiConversationDTO(found.value) : null)
  },

  /** Pergunta livre ao copiloto sobre o chamado (histórico por agente). */
  async chat(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdAiChatMessageDTO,
  ): Promise<Result<SdAiConversationDTO>> {
    const loaded = await agentTicket(actorId, workspaceId, ticketRef)
    if (!loaded.ok) return loaded
    const { config, ticket } = loaded.value
    const call = await prepareCall(
      config.settings,
      workspaceId,
      'SERVICEDESK_COPILOT',
      actorId,
    )
    if (!call.ok) return call

    const found = await SdAiRepository.findCopilotConversation(
      workspaceId,
      ticket.id,
      actorId,
    )
    if (!found.ok) return found
    let conversation = found.value
    if (!conversation) {
      const created = await SdAiRepository.createConversation({
        workspaceId,
        mode: 'COPILOT',
        userId: actorId,
        ticketId: ticket.id,
      })
      if (!created.ok) return created
      conversation = created.value
    }

    const context = await ticketContext(ticket, config)
    if (!context.ok) return context
    const history: SdAiMessageDTO[] = [
      ...parseSdAiMessages(conversation.messages),
      { role: 'user', content: dto.message, at: now() },
    ]
    const response = await complete(
      call.value,
      {
        system: buildSdCopilotSystem('chat', config.settings, context.value),
        messages: history
          .slice(-COPILOT_HISTORY)
          .map((m) =>
            m.role === 'user'
              ? { role: 'user', content: redactSdPii(m.content) }
              : { role: 'assistant', content: m.content },
          ),
        maxTokens: 1500,
      },
      workspaceId,
      actorId,
    )
    if (!response.ok) return response
    history.push({
      role: 'assistant',
      content: response.value.text.trim() || 'Não consegui responder agora.',
      at: now(),
    })
    const saved = await SdAiRepository.updateConversation(conversation.id, {
      messages: storedMessages(history),
    })
    if (!saved.ok) return saved
    return ok(toSdAiConversationDTO(saved.value))
  },

  /** Limpa a conversa do copiloto do agente neste chamado. */
  async resetChat(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<void>> {
    const loaded = await agentTicket(actorId, workspaceId, ticketRef)
    if (!loaded.ok) return loaded
    const found = await SdAiRepository.findCopilotConversation(
      workspaceId,
      loaded.value.ticket.id,
      actorId,
    )
    if (!found.ok) return found
    if (!found.value) return ok(undefined)
    return SdAiRepository.deleteConversation(found.value.id)
  },

  /* ---------------------- pré-atendimento (portal) ---------------------- */

  /** Uma mensagem do solicitante; a IA responde, sugere artigos e o rascunho. */
  async preServiceMessage(
    actorId: string,
    workspaceId: string,
    dto: SdAiPreServiceMessageDTO,
  ): Promise<Result<SdAiPreServiceReplyDTO>> {
    const loaded = await preServiceAccess(actorId, workspaceId)
    if (!loaded.ok) return loaded
    const { ctx, config } = loaded.value
    const { settings } = config

    let conversation: SdAiConversation
    if (dto.conversationId) {
      const own = await ownPreService(actorId, workspaceId, dto.conversationId)
      if (!own.ok) return own
      conversation = own.value
    } else {
      const created = await SdAiRepository.createConversation({
        workspaceId,
        mode: 'PRE_SERVICE',
        userId: actorId,
      })
      if (!created.ok) return created
      conversation = created.value
    }

    const history: SdAiMessageDTO[] = [
      ...parseSdAiMessages(conversation.messages),
      { role: 'user', content: dto.message, at: now() },
    ]
    const portalOnly = !ctx.isAgent
    const types = allowedTypes(settings, portalOnly)

    let reply: string
    let action: SdAiTurnOutput['action']
    let articles: SdAiArticleCardDTO[] = []
    let draft: SdAiTicketDraftDTO
    let suggestOpenTicket: boolean
    if (sdHandoffRequested(dto.message, settings.aiHandoffKeywords)) {
      // Pediu humano: não gasta IA, só entrega o rascunho para abrir.
      reply = HANDOFF_REPLY
      action = 'open_ticket'
      draft =
        lastDraft(conversation.messages) ??
        normalizeDraft(null, { categories: [], urgencies: [] }, types, history)
      if (!types.includes(draft.type)) draft = { ...draft, type: types[0] }
      suggestOpenTicket = true
    } else {
      const turn = await assistantTurn({
        workspaceId,
        settings,
        userId: actorId,
        channel: 'portal',
        history,
        portalOnly,
      })
      if (!turn.ok) return turn
      reply = turn.value.output.reply
      action = turn.value.output.action
      articles = turn.value.articles
      draft = turn.value.draft
      suggestOpenTicket = shouldOpenTicket(turn.value.output)
    }

    const assistant = {
      role: 'assistant' as const,
      content: reply,
      at: now(),
      ...(articles.length > 0 ? { articles } : {}),
    }
    const stored = [...history, { ...assistant, draft }]
    const saved = await SdAiRepository.updateConversation(conversation.id, {
      messages: stored as unknown as Prisma.InputJsonValue,
    })
    if (!saved.ok) return saved

    logger.info('servicedesk.ai.pre_service_turn', {
      workspaceId,
      conversationId: conversation.id,
      action,
      articles: articles.length,
      suggestOpenTicket,
    })
    return ok({
      conversation: toSdAiConversationDTO(saved.value),
      reply,
      action,
      articles,
      suggestOpenTicket,
      ticketDraft: draft,
    })
  },

  /** "Abrir chamado": cria o chamado (portal) com a transcrição. */
  async preServiceOpenTicket(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SdAiPreServiceOpenTicketDTO,
  ): Promise<Result<SdAiOpenedTicketDTO>> {
    const loaded = await preServiceAccess(actorId, workspaceId)
    if (!loaded.ok) return loaded
    const { ctx, config } = loaded.value
    const own = await ownPreService(actorId, workspaceId, conversationId)
    if (!own.ok) return own

    const history = parseSdAiMessages(own.value.messages)
    const draft = lastDraft(own.value.messages)
    const portal = !ctx.isAgent
    const types = allowedTypes(config.settings, portal)
    const type = dto.type ?? draft?.type ?? types[0]
    if (portal && !types.includes(type)) {
      return err(
        sdTicketForbidden(
          'Este tipo de chamado não pode ser aberto pelo portal',
        ),
      )
    }
    const userTexts = history
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
    const title =
      dto.title ??
      (draft?.title && draft.title.length >= 3
        ? draft.title
        : clipSdText(
            userTexts[0]?.split('\n')[0] || 'Solicitação via assistente',
            120,
          ))
    const description =
      dto.description ?? draft?.description ?? userTexts.join('\n\n')

    const base = {
      type,
      title,
      description: description ? sdPlainTextToHtml(description) : undefined,
      channel: 'PORTAL' as const,
      requesterId: actorId,
      portal,
    }
    const catalog = {
      categoryId: draft?.categoryId ?? undefined,
      subcategoryId: draft?.subcategoryId ?? undefined,
      serviceId: draft?.serviceId ?? undefined,
      urgencyId: draft?.urgencyId ?? undefined,
    }
    const actor = sdUserActor(ctx)
    let created = await SdTicketEngine.create(
      workspaceId,
      { ...base, ...catalog },
      actor,
      config,
    )
    if (
      !created.ok &&
      Object.values(catalog).some(Boolean) &&
      CATALOG_ERRORS.has(created.error.code)
    ) {
      created = await SdTicketEngine.create(workspaceId, base, actor, config)
    }
    if (!created.ok) {
      auditMutation({
        entity: 'sd_ticket',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
        meta: { workspaceId, channel: 'PORTAL', source: 'ai_pre_service' },
      })
      return created
    }
    const ticket = created.value

    await SdWhatsappRepository.createTicketMessage({
      workspaceId,
      ticketId: ticket.id,
      authorKind: 'AI',
      channel: 'PLATFORM',
      body: `Pré-atendimento por IA:\n\n${sdAiTranscript(history)}`,
    })
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: 'AI',
      action: 'ai.pre_service',
      meta: { conversationId, channel: 'PORTAL' },
    })
    await publishSdTicketMessage(ticket, actorId)
    const saved = await SdAiRepository.updateConversation(conversationId, {
      outcome: 'ticket_opened',
      ticketId: ticket.id,
    })
    if (!saved.ok) return saved
    auditMutation({
      entity: 'sd_ticket',
      action: 'create',
      actorId,
      targetId: ticket.id,
      meta: {
        workspaceId,
        type: ticket.type,
        channel: 'PORTAL',
        source: 'ai_pre_service',
      },
    })
    void fireSdAutomations('TICKET_CREATED', ticket.id, { actorId })
    return ok({
      id: ticket.id,
      number: ticket.number,
      code: sdTicketCode(ticket, config.prefixes),
    })
  },

  /** Encerra sem chamado: resolvido pela base ou desistência. */
  async preServiceClose(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SdAiPreServiceCloseDTO,
  ): Promise<Result<SdAiConversationDTO>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const own = await ownPreService(actorId, workspaceId, conversationId)
    if (!own.ok) return own
    const saved = await SdAiRepository.updateConversation(conversationId, {
      outcome: dto.outcome,
    })
    if (!saved.ok) return saved
    logger.info('servicedesk.ai.pre_service_closed', {
      workspaceId,
      conversationId,
      outcome: dto.outcome,
    })
    return ok(toSdAiConversationDTO(saved.value))
  },

  /* ------------------------------ jobs ------------------------------ */

  /**
   * Triagem automática (job): preenche só os campos vazios com sugestões
   * validadas contra o catálogo e grava `aiTriage`.
   */
  async triageTicket(ticketId: string): Promise<Result<SdAiTriageOutcome>> {
    const found = await SdTicketRepository.findByIdUnscoped(ticketId)
    if (!found.ok) {
      if (found.error.code === 'SD_TICKET_NOT_FOUND') {
        return ok({ status: 'skipped', reason: 'ticket_not_found' })
      }
      return found
    }
    const ticket = found.value
    const workspaceId = ticket.workspaceId
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const { settings } = config.value
    if (!settings.aiEnabled || !settings.aiAutoTriageEnabled) {
      return ok({ status: 'skipped', reason: 'ai_disabled' })
    }
    if (ticket.aiTriage)
      return ok({ status: 'skipped', reason: 'already_triaged' })

    const call = await AiUsageService.prepare(workspaceId, 'SERVICEDESK_TRIAGE')
    if (!call.ok) {
      return ok({ status: 'skipped', reason: prepareFailure(call.error.code) })
    }
    const catalog = await SdAiRepository.loadCatalog(workspaceId, {
      type: ticket.type,
    })
    if (!catalog.ok) return catalog
    const response = await complete(
      call.value,
      {
        system: buildSdTriageSystem(catalog.value),
        messages: [{ role: 'user', content: triageInput(ticket) }],
        jsonSchema: { name: 'sd_triage', schema: SD_AI_TRIAGE_JSON_SCHEMA },
        maxTokens: 800,
      },
      workspaceId,
      null,
    )
    if (!response.ok) return ok({ status: 'failed', reason: 'provider_failed' })
    const output = parseSdAiJson(SdAiTriageOutputSchema, response.value.text)
    if (!output)
      return ok({ status: 'skipped', reason: 'unparseable_response' })

    const suggestions = toSdAiClassification(output, catalog.value)
    const changes = triageChanges(ticket, suggestions)
    let applied = Object.keys(changes)
    if (applied.length > 0) {
      const updated = await SdTicketEngine.update(
        ticket,
        changes,
        sdSystemActor('ai-triage'),
        config.value,
        { eventMeta: { via: 'ai_triage' }, touchActivity: false },
      )
      if (!updated.ok) {
        logger.warn('servicedesk.ai.triage_apply_failed', {
          workspaceId,
          ticketId,
          reason: updated.error.code,
        })
        applied = []
      }
    }

    const record: SdAiTriageRecordDTO = {
      suggestions,
      applied,
      model: call.value.model.key,
      at: now(),
    }
    const saved = await SdAiRepository.setTicketAi(ticket.id, {
      aiTriage: record as unknown as Prisma.InputJsonValue,
    })
    if (!saved.ok) return saved
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: 'AI',
      action: 'ai.triaged',
      meta: { applied, confidence: suggestions.confidence },
    })
    logger.info('servicedesk.ai.triaged', {
      workspaceId,
      ticketId,
      applied: applied.join(','),
      confidence: suggestions.confidence,
    })
    return ok({
      status: 'triaged',
      applied,
      confidence: suggestions.confidence,
    })
  },

  /**
   * Resposta da IA a uma mensagem recebida no WhatsApp do ServiceDesk (job).
   * Sem chamado aberto: pré-atendimento (resolve pela base ou abre o
   * chamado). Com chamado aberto sem atendente: resposta automática.
   * Falha da IA no pré-atendimento abre o chamado (ninguém fica sem
   * resposta).
   */
  async whatsappReply(input: {
    conversationId: string
    messageId: string
  }): Promise<Result<SdAiWhatsappOutcome>> {
    const found = await SdWhatsappRepository.findConversationUnscoped(
      input.conversationId,
    )
    if (!found.ok) return found
    const conversation = found.value
    if (!conversation) {
      return ok({ status: 'skipped', reason: 'conversation_not_found' })
    }
    const workspaceId = conversation.workspaceId
    const message = await WhatsAppMessageRepository.findById(input.messageId)
    if (!message.ok) return message
    if (!message.value || message.value.conversationId !== conversation.id) {
      return ok({ status: 'skipped', reason: 'message_not_found' })
    }
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const { settings } = config.value
    const content = waContent(message.value)

    const open = await SdWhatsappRepository.findOpenTicket(
      workspaceId,
      conversation.id,
    )
    if (!open.ok) return open
    if (open.value) {
      return autoReply({
        conversation,
        config: config.value,
        ticketId: open.value.id,
        content,
      })
    }

    // Pré-atendimento
    const active = await SdAiRepository.findActiveWhatsappConversation(
      conversation.id,
    )
    if (!active.ok) return active
    let aiConversation = active.value
    if (!aiConversation) {
      const created = await SdAiRepository.createConversation({
        workspaceId,
        mode: 'PRE_SERVICE',
        whatsappConversationId: conversation.id,
      })
      if (!created.ok) return created
      aiConversation = created.value
      await WhatsAppConversationRepository.update(conversation.id, {
        aiActive: true,
        aiHandoff: false,
      })
    }
    const history: SdAiMessageDTO[] = [
      ...parseSdAiMessages(aiConversation.messages),
      { role: 'user', content, at: now() },
    ]
    const previousDraft = lastDraft(aiConversation.messages)

    if (!settings.aiEnabled || !settings.aiPreServiceEnabled) {
      return openFromPreService({
        conversation,
        config: config.value,
        aiConversation,
        history,
        draft: previousDraft,
        reason: 'ai_disabled',
      })
    }
    if (sdHandoffRequested(content, settings.aiHandoffKeywords)) {
      return openFromPreService({
        conversation,
        config: config.value,
        aiConversation,
        history,
        draft: previousDraft,
        reason: 'handoff_keyword',
      })
    }

    const turn = await assistantTurn({
      workspaceId,
      settings,
      userId: null,
      channel: 'whatsapp',
      history,
      portalOnly: true,
    })
    if (!turn.ok) {
      return openFromPreService({
        conversation,
        config: config.value,
        aiConversation,
        history,
        draft: previousDraft,
        reason: `ai_${turn.error.code.toLowerCase()}`,
      })
    }
    const { output, articles, draft, guardrail } = turn.value
    if (guardrail) {
      reportAutoReplyGuardrailHit({
        workspaceId,
        feature: 'SERVICEDESK_PRE_SERVICE',
        kind: guardrail.kind,
        targetType: 'sd_ai_conversation',
        targetId: aiConversation.id,
      })
      return openFromPreService({
        conversation,
        config: config.value,
        aiConversation,
        history,
        draft,
        reason: `guardrail_${guardrail.kind}`,
        note: guardrail.note,
      })
    }
    if (shouldOpenTicket(output)) {
      return openFromPreService({
        conversation,
        config: config.value,
        aiConversation,
        history,
        draft,
        reason:
          output.action === 'open_ticket' ? 'ai_decision' : 'low_confidence',
      })
    }

    const sent = await sendSdWhatsappText({
      connection: conversation.connection,
      conversationId: conversation.id,
      waId: conversation.contact.waId,
      text: output.reply,
      sentByAi: true,
    })
    if (!sent.ok) return ok({ status: 'failed', reason: sent.error.code })

    const stored = [
      ...history,
      {
        role: 'assistant' as const,
        content: output.reply,
        at: now(),
        ...(articles.length > 0 ? { articles } : {}),
        draft,
      },
    ]
    const resolved = output.action === 'resolved'
    const saved = await SdAiRepository.updateConversation(aiConversation.id, {
      messages: stored as unknown as Prisma.InputJsonValue,
      ...(resolved ? { outcome: 'resolved_by_kb' } : {}),
    })
    if (!saved.ok) return saved
    if (resolved) {
      await WhatsAppConversationRepository.update(conversation.id, {
        aiActive: false,
      })
    }
    return ok({ status: 'replied', action: output.action })
  },
}

/** Texto enviado para a triagem (sem dados pessoais). */
function triageInput(ticket: SdTicketWithRelations): string {
  // Ticket text is third-party content (ADR 0041): fenced as data.
  return wrapUntrusted(
    `Tipo: ${TYPE_LABEL[ticket.type]}\nTítulo: ${redactSdPii(ticket.title)}\nDescrição:\n${redactSdPii(clipSdText(sdHtmlToText(ticket.description ?? '') || '(sem descrição)', 4000))}`,
    'ticket',
  )
}

/** Só os campos vazios do chamado recebem a sugestão da triagem. */
function triageChanges(
  ticket: SdTicketWithRelations,
  s: SdAiClassificationDTO,
): SdEngineChanges {
  const changes: SdEngineChanges = {}
  if (!ticket.categoryId && s.category) {
    changes.categoryId = s.category.id
    if (s.subcategory) changes.subcategoryId = s.subcategory.id
    if (s.service) changes.serviceId = s.service.id
  }
  if (!ticket.impactId && s.impact) changes.impactId = s.impact.id
  if (!ticket.urgencyId && s.urgency) changes.urgencyId = s.urgency.id
  // Impacto/urgência recalculam a prioridade pela matriz; a sugerida só
  // entra quando o chamado não tem prioridade nenhuma.
  if (
    !ticket.priorityId &&
    s.priority &&
    !changes.impactId &&
    !changes.urgencyId
  ) {
    changes.priorityId = s.priority.id
  }
  if (!ticket.departmentId && s.department)
    changes.departmentId = s.department.id
  if (ticket.tags.length === 0 && s.tags.length > 0) changes.tags = s.tags
  return changes
}

/** Resposta automática num chamado aberto ainda sem atendente. */
async function autoReply(input: {
  conversation: SdWaConversation
  config: SdEngineConfig
  ticketId: string
  content: string
}): Promise<Result<SdAiWhatsappOutcome>> {
  const { conversation, config } = input
  const { settings } = config
  const workspaceId = conversation.workspaceId
  if (!settings.aiEnabled || !settings.aiWhatsappAutoReply) {
    return ok({ status: 'skipped', reason: 'ai_disabled' })
  }
  const ticket = await SdTicketRepository.findById(input.ticketId, workspaceId)
  if (!ticket.ok) return ticket
  if (
    ticket.value.assigneeId ||
    ticket.value.firstRespondedAt ||
    conversation.aiHandoff
  ) {
    return ok({ status: 'skipped', reason: 'human_handling' })
  }

  const handoff = sdHandoffRequested(input.content, settings.aiHandoffKeywords)
  let reply: string
  let action: SdAiTurnOutput['action'] = 'open_ticket'
  let guardrail: AutoReplyLimitHit | undefined
  if (handoff) {
    reply = 'Certo! Avisei o time — um atendente vai continuar por aqui.'
  } else {
    // Contexto: as mensagens do contato/IA desde a abertura do chamado.
    const recent = await WhatsAppMessageRepository.listLatestByConversation(
      conversation.id,
      PRE_SERVICE_HISTORY,
    )
    if (!recent.ok) return recent
    const history = recent.value
      .filter((m) => m.createdAt >= ticket.value.createdAt)
      .reverse()
      .map((m) => ({
        role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
        content: waContent(m),
      }))
    const turn = await assistantTurn({
      workspaceId,
      settings,
      userId: null,
      channel: 'whatsapp',
      history:
        history.length > 0
          ? history
          : [{ role: 'user', content: input.content }],
      portalOnly: true,
      ticketOpen: {
        code: sdTicketCode(ticket.value, config.prefixes),
        title: ticket.value.title,
      },
    })
    if (!turn.ok) return ok({ status: 'failed', reason: turn.error.code })
    reply = turn.value.output.reply
    action = turn.value.output.action
    guardrail = turn.value.guardrail
    if (guardrail) {
      reportAutoReplyGuardrailHit({
        workspaceId,
        feature: 'SERVICEDESK_PRE_SERVICE',
        kind: guardrail.kind,
        targetType: 'sd_ticket',
        targetId: ticket.value.id,
      })
    }
  }

  const sent = await sendSdWhatsappText({
    connection: conversation.connection,
    conversationId: conversation.id,
    waId: conversation.contact.waId,
    text: reply,
    sentByAi: true,
  })
  if (!sent.ok) return ok({ status: 'failed', reason: sent.error.code })
  await mirrorSdWhatsappMessage({
    ticket: ticket.value,
    message: sent.value,
    authorKind: 'AI',
  })
  if (handoff || action === 'open_ticket') {
    await WhatsAppConversationRepository.update(conversation.id, {
      aiActive: false,
      aiHandoff: true,
    })
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.value.id,
      actorKind: 'AI',
      action: 'ai.handoff',
      meta: {
        channel: 'WHATSAPP',
        trigger: handoff ? 'keyword' : guardrail ? 'guardrail' : 'ai',
        ...(guardrail && { guardrail: guardrail.kind, note: guardrail.note }),
      },
    })
    return ok({ status: 'handoff' })
  }
  return ok({ status: 'replied', action })
}
