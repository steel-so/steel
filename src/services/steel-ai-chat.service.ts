import { createId } from '@paralleldrive/cuid2'
import type { AiConversation, ModuleKind, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { aiDisabled, aiToolNotAllowed } from '@/src/errors/app-error'
import {
  AI_ATTACHMENT_ACCEPT,
  AI_ATTACHMENT_MAX_DOCUMENT_BYTES,
  AI_ATTACHMENT_MAX_IMAGE_BYTES,
  AI_ATTACHMENT_MAX_PER_MESSAGE,
  buildUserContent,
} from '@/src/lib/ai/attachments'
import { memoryForPrompt } from '@/src/lib/ai/context/memory'
import { readMemoryRef } from '@/src/lib/ai/context/memory-tool-names'
import { STEEL_AI_MEMORY_TOOLS } from '@/src/lib/ai/context/memory-tools'
import {
  resolveSkillInvocation,
  skillsCatalogForPrompt,
} from '@/src/lib/ai/context/skills'
import {
  readCitations,
  STEEL_SEARCH_TOOL_NAME,
} from '@/src/lib/ai/knowledge/citations'
import { AI_PROVIDER_LABELS, findAiModel } from '@/src/lib/ai/models'
import { addAiUsage, currentPeriodStart } from '@/src/lib/ai/quota'
import {
  capHistory,
  HISTORY_MAX_ROWS,
  toProviderHistory,
} from '@/src/lib/ai/steel-ai-history'
import { buildSteelAiSystemPrompt } from '@/src/lib/ai/steel-ai-prompt'
import {
  type AiToolAccess,
  availableTools,
  proposeWriteTool,
  resolveToolAccess,
  runReadTool,
  runTool,
  type SteelAiMode,
  simulateWriteTool,
  toolMeta,
  toToolSpecs,
} from '@/src/lib/ai/tools/registry'
import {
  FIND_TOOLS_TOOL_NAME,
  findTools,
  pinnedToolsFromHistory,
  selectionSpecs,
  selectSteelAiTools,
} from '@/src/lib/ai/tools/selection'
import { serializeToolResult } from '@/src/lib/ai/tools/tool-result'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type {
  AiChatResponse,
  AiMessage,
  AiToolCall,
  AiUsageTokens,
} from '@/src/lib/ai/types'
import { err, ok, type Result } from '@/src/lib/result'
import { toAiToolCallDTO } from '@/src/mappers/ai-conversation.mapper'
import { toAiPendingActionDTO } from '@/src/mappers/ai-pending-action.mapper'
import type { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { toAiModelPriceDTOs } from '@/src/mappers/platform-ai-settings.mapper'
import { AiAttachmentRepository } from '@/src/repositories/ai-attachment.repository'
import {
  AiConversationRepository,
  AiMessageRepository,
  type CreateAiMessageInput,
} from '@/src/repositories/ai-conversation.repository'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { UserPreferenceRepository } from '@/src/repositories/user-preference.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { SendAiMessageInput } from '@/src/schemas/steel-ai.schema'
import type {
  AiCapabilitiesDTO,
  AiChatModelDTO,
  AiMessageDTO,
  AiModuleDTO,
  AiPendingActionDTO,
  AiToolCallDTO,
  SteelAiStreamEvent,
} from '@/types/steel-ai'
import { AiAttachmentService } from './ai-attachment.service'
import { checkSteelAiMode } from './ai-conversation.service'
import { executeAutopilotWrite } from './ai-pending-action.service'
import { isModelUsable } from './ai-settings.service'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

/** Tool rounds per user message (the last one is forced to answer in text). */
export const STEEL_AI_MAX_TOOL_ROUNDS = 8

const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
const MODULE_ORDER: ModuleKind[] = ['SERVICE_DESK', 'CRM', 'COMMUNICATION']

const REFUSAL_REPLY =
  'Não posso ajudar com esse pedido. Tente reformular a pergunta.'
const EMPTY_REPLY = 'Não consegui gerar uma resposta agora.'
const PROVIDER_ERROR =
  'Não foi possível falar com o provedor de IA agora. Tente novamente em instantes.'
const PERSIST_ERROR =
  'Não foi possível salvar a conversa. Tente novamente em instantes.'
const PENDING_NOTE =
  'Proposta registrada e aguardando o usuário confirmar ou cancelar na tela. Não chame esta ferramenta de novo; responda em uma ou duas frases o que foi proposto.'
const ROUND_LIMIT_NOTE =
  'Limite de etapas desta resposta atingido; a ferramenta não foi executada. Responda com o que já sabe.'
const TITLE_PROMPT =
  'Crie um título curto (no máximo 6 palavras) em português do Brasil para a conversa abaixo. Responda só com o título, sem aspas nem pontuação final.'

function sortModules(modules: ModuleKind[]): AiModuleDTO[] {
  return MODULE_ORDER.filter((m) => modules.includes(m))
}

/**
 * Module an interaction is billed to in `AiUsage.module`: the module of the
 * tools called in the turn. None (or only platform tools) → null; mixed →
 * the one with the most calls, ties going to the module used first.
 */
export function dominantModule(
  modules: (ModuleKind | null)[],
): ModuleKind | null {
  const counts = new Map<ModuleKind, number>()
  for (const module of modules) {
    if (module) counts.set(module, (counts.get(module) ?? 0) + 1)
  }
  let best: ModuleKind | null = null
  for (const [module, count] of counts) {
    // Map keeps insertion order, so `>` keeps the first module on a tie.
    if (best === null || count > (counts.get(best) as number)) best = module
  }
  return best
}

/** Picker list: enabled + usable models, charged price (provider × margin). */
async function chatModels(
  settings: ReturnType<typeof toEffectiveAiSettings>,
): Promise<AiChatModelDTO[]> {
  const margin = await PlatformAiSettingsService.getCostMargin()
  return toAiModelPriceDTOs(margin)
    .filter((price) => isModelUsable(settings, price.key))
    .map((price) => ({
      key: price.key,
      provider: price.provider,
      providerLabel: AI_PROVIDER_LABELS[price.provider],
      label: price.label,
      inputUsdPer1M: price.chargedInputUsdPer1M,
      outputUsdPer1M: price.chargedOutputUsdPer1M,
    }))
}

const ATTACHMENT_LIMITS: AiCapabilitiesDTO['attachments'] = {
  maxPerMessage: AI_ATTACHMENT_MAX_PER_MESSAGE,
  maxImageBytes: AI_ATTACHMENT_MAX_IMAGE_BYTES,
  maxDocumentBytes: AI_ATTACHMENT_MAX_DOCUMENT_BYTES,
  accept: AI_ATTACHMENT_ACCEPT,
}

/** System block for a skill invoked with "/<slug>". */
function skillSection(skill: {
  slug: string
  name: string
  instructions: string
}): string {
  return `Skill invocada pelo usuário: /${skill.slug} (${skill.name}). Siga estas instruções nesta resposta:\n${skill.instructions}`
}

/** Thrown inside the turn when a round cannot be persisted. */
class PersistError extends Error {}

function fallbackTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine
}

function cleanTitle(text: string): string {
  return text
    .replace(/^["'“”«»\s#*]+|["'“”«»\s.*]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
}

interface TurnInput {
  actorId: string
  workspaceId: string
  conversation: AiConversation
  mode: SteelAiMode
  access: AiToolAccess
  call: PreparedAiCall
  system: string
  history: AiMessage[]
  /** User text (tool selection and title); may be empty with attachments. */
  content: string
  /** What the title is generated from when `content` is empty. */
  titleSource: string
  /** Model key kept on the conversation after the turn (null = the used one). */
  storedModelKey: string | null
  isFirstExchange: boolean
  /** Tools called/activated in the recent history, most recent first. */
  pinnedTools: string[]
  /** Earlier user messages, most recent first (module detection). */
  previousMessages: string[]
}

async function generateTitle(
  input: TurnInput,
  reply: string,
  usage: AiUsageTokens,
): Promise<string> {
  try {
    const response = await input.call.provider.chat({
      model: input.call.model.model,
      system: TITLE_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Usuário: ${input.titleSource.slice(0, 1_000)}\n\nAssistente: ${reply.slice(0, 1_000)}`,
        },
      ],
      maxTokens: 40,
    })
    addAiUsage(usage, response.usage)
    const title = cleanTitle(response.text)
    if (title) return title
  } catch (cause) {
    logger.warn(
      'steel_ai.title_failed',
      logFields({
        component: 'SteelAiChatService',
        workspaceId: input.workspaceId,
        conversationId: input.conversation.id,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  }
  return fallbackTitle(input.titleSource)
}

async function* runTurn(
  input: TurnInput,
): AsyncGenerator<SteelAiStreamEvent, void, undefined> {
  const { conversation, call } = input
  const messageId = createId()
  const startedAt = new Date()
  // Everything the caller may run; each round only *shows* a selection.
  const tools = availableTools(input.access, input.mode)
  // Memory tools run in every mode, without confirmation (metadata).
  const memoryTools = input.access.memoryEnabled ? STEEL_AI_MEMORY_TOOLS : []
  const memorySpecs = toToolSpecs(memoryTools)
  const activated: string[] = []
  const roundSpecs = () => [
    ...selectionSpecs(
      selectSteelAiTools({
        available: tools,
        message: input.content,
        previousMessages: input.previousMessages,
        pinned: [
          ...activated,
          ...[...toolNames].reverse(),
          ...input.pinnedTools,
        ],
      }),
    ),
    ...memorySpecs,
  ]
  let maxSpecChars = 0
  const ctx: AiToolContext = {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    source: 'assistant',
    conversationId: conversation.id,
  }
  const messages: AiMessage[] = [...input.history]
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 }
  const texts: string[] = []
  const toolCalls: AiToolCallDTO[] = []
  const pendingActions: AiPendingActionDTO[] = []
  /** Autopilot writes already executed in this turn. */
  const executedActions: AiPendingActionDTO[] = []
  /** Teste mode: writes simulated in this turn (nothing executed). */
  let simulatedCount = 0
  /** Every action of the turn (proposed or executed), in creation order. */
  const actions: AiPendingActionDTO[] = []
  const toolNames: string[] = []
  /** Module of every domain tool called (usage scope). */
  const toolModules: (ModuleKind | null)[] = []
  let firstRow = true

  yield { type: 'message.start', conversationId: conversation.id, messageId }

  const persist = async (rows: CreateAiMessageInput[]) => {
    const saved = await AiMessageRepository.createMany(
      rows.map((row, index) =>
        firstRow && index === 0 ? { ...row, id: messageId } : row,
      ),
    )
    if (!saved.ok) throw new PersistError(saved.error.message)
    firstRow = false
  }

  /** Executes one tool call (or turns a write into a pending action). */
  async function* handleToolCall(
    toolCall: AiToolCall,
    forceText: boolean,
  ): AsyncGenerator<
    SteelAiStreamEvent,
    { content: string; proposed: boolean },
    undefined
  > {
    const running = toAiToolCallDTO(toolCall, toolMeta, 'running')
    yield { type: 'tool.start', call: running }
    toolNames.push(toolCall.name)

    const tool: AnySteelAiTool | undefined = tools.find(
      (t) => t.name === toolCall.name,
    )
    const memoryTool = memoryTools.find((t) => t.name === toolCall.name)
    let status: AiToolCallDTO['status'] = 'error'
    let summary: string | undefined
    let content: string
    let proposed = false
    let memory: AiToolCallDTO['memory']
    let simulation: AiToolCallDTO['simulation']
    let citations: AiToolCallDTO['citations']
    // Teste: every write — memory included — is simulated here, on the
    // server; `execute` is never reached for it.
    const simulated =
      input.mode === 'TEST'
        ? (memoryTool ?? (tool && tool.kind !== 'READ' ? tool : undefined))
        : undefined

    if (forceText) {
      content = serializeToolResult({
        status: 'error',
        error: { code: 'ROUND_LIMIT', message: ROUND_LIMIT_NOTE },
      })
      summary = 'Não executada'
    } else if (toolCall.name === FIND_TOOLS_TOOL_NAME) {
      const found = findTools(tools, toolCall.arguments)
      activated.unshift(...found.names)
      content = serializeToolResult({
        status: 'done',
        summary: found.summary,
        data: found.data,
      })
      status = 'done'
      summary = found.summary
    } else if (simulated) {
      if (simulated.module) toolModules.push(simulated.module)
      const run = await simulateWriteTool(simulated, ctx, toolCall.arguments, {
        actorId: input.actorId,
      })
      content = run.content
      if (run.ok) {
        simulatedCount++
        simulation = run.simulation
        status = 'simulated'
        summary = run.simulation.preview.title
      } else {
        summary = run.error.message
      }
    } else if (memoryTool) {
      const run = await runTool(memoryTool, ctx, toolCall.arguments)
      content = run.content
      status = run.ok ? 'done' : 'error'
      summary = run.ok ? run.output.summary : run.error.message
      if (run.ok) memory = readMemoryRef(run.output.data) ?? undefined
    } else if (!tool) {
      const error = aiToolNotAllowed(
        'Ferramenta indisponível neste modo ou para o seu perfil',
      )
      content = serializeToolResult({
        status: 'error',
        error: { code: error.code, message: error.message },
      })
      summary = error.message
    } else if (tool.kind === 'READ') {
      toolModules.push(tool.module)
      const run = await runReadTool(tool, ctx, toolCall.arguments)
      content = run.content
      status = run.ok ? 'done' : 'error'
      summary = run.ok ? run.output.summary : run.error.message
      if (run.ok && tool.name === STEEL_SEARCH_TOOL_NAME) {
        const found = readCitations(run.output.data)
        if (found.length > 0) citations = found
      }
    } else if (input.mode === 'AUTOPILOT') {
      toolModules.push(tool.module)
      const executed = await executeAutopilotWrite(
        tool,
        ctx,
        toolCall.arguments,
        { conversationId: conversation.id, toolCallId: toolCall.id },
      )
      if (executed.ok) {
        const dto = toAiPendingActionDTO(executed.value.action)
        executedActions.push(dto)
        actions.push(dto)
        yield { type: 'action.executed', action: dto }
        content = executed.value.content
        status = dto.status === 'EXECUTED' ? 'done' : 'error'
        summary =
          dto.status === 'EXECUTED'
            ? (dto.resultSummary ?? dto.preview.title)
            : (dto.error ?? dto.preview.title)
      } else {
        content = serializeToolResult({
          status: 'error',
          error: {
            code: executed.error.code,
            message: executed.error.message,
          },
        })
        summary = executed.error.message
      }
    } else {
      toolModules.push(tool.module)
      const action = await proposeWriteTool(tool, ctx, toolCall.arguments, {
        conversationId: conversation.id,
        toolCallId: toolCall.id,
      })
      if (action.ok) {
        const dto = toAiPendingActionDTO(action.value)
        pendingActions.push(dto)
        actions.push(dto)
        yield { type: 'action.pending', action: dto }
        content = serializeToolResult({
          status: 'pending_confirmation',
          actionId: dto.id,
          summary: dto.preview.title,
          note: PENDING_NOTE,
        })
        status = 'pending_confirmation'
        summary = dto.preview.title
        proposed = true
      } else {
        content = serializeToolResult({
          status: 'error',
          error: { code: action.error.code, message: action.error.message },
        })
        summary = action.error.message
      }
    }

    const finished: AiToolCallDTO = {
      ...running,
      status,
      summary,
      ...(memory && { memory }),
      ...(simulation && { simulation }),
      ...(citations && { citations }),
    }
    toolCalls.push(finished)
    yield { type: 'tool.end', call: finished }
    return { content, proposed }
  }

  try {
    let stopAfterNextRound = false
    for (let round = 0; round < STEEL_AI_MAX_TOOL_ROUNDS; round++) {
      const forceText =
        stopAfterNextRound || round === STEEL_AI_MAX_TOOL_ROUNDS - 1
      let response: AiChatResponse | null = null
      let roundHasText = false
      const specs = roundSpecs()
      maxSpecChars = Math.max(maxSpecChars, JSON.stringify(specs).length)

      for await (const chunk of call.provider.chatStream({
        model: call.model.model,
        system: input.system,
        messages,
        ...(specs.length > 0 && {
          tools: specs,
          toolChoice: forceText ? ('none' as const) : ('auto' as const),
        }),
      })) {
        if (chunk.type === 'done') {
          response = chunk.response
          continue
        }
        if (!roundHasText && texts.length > 0) {
          yield { type: 'text.delta', delta: '\n\n' }
        }
        roundHasText = true
        yield { type: 'text.delta', delta: chunk.delta }
      }
      if (!response) throw new Error('Provider stream ended without a response')

      addAiUsage(usage, response.usage)

      let text = response.text
      if (!text && response.stopReason === 'refusal') {
        text = REFUSAL_REPLY
        yield {
          type: 'text.delta',
          delta: texts.length > 0 ? `\n\n${text}` : text,
        }
      }
      if (text) texts.push(text)

      const rows: CreateAiMessageInput[] = [
        {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: text,
          ...(response.toolCalls.length > 0 && {
            toolCalls: response.toolCalls as unknown as Prisma.InputJsonValue,
          }),
          ...(response.message.raw && {
            raw: response.message.raw as unknown as Prisma.InputJsonValue,
          }),
          modelKey: call.model.key,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      ]
      const toolMessages: AiMessage[] = []
      for (const toolCall of response.toolCalls) {
        const handled = yield* handleToolCall(toolCall, forceText)
        if (handled.proposed) stopAfterNextRound = true
        rows.push({
          conversationId: conversation.id,
          role: 'TOOL',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: handled.content,
        })
        toolMessages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: handled.content,
        })
      }
      await persist(rows)
      messages.push(response.message, ...toolMessages)

      if (response.toolCalls.length === 0 || forceText) break
    }

    if (texts.length === 0) {
      texts.push(EMPTY_REPLY)
      yield { type: 'text.delta', delta: EMPTY_REPLY }
      await persist([
        {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: EMPTY_REPLY,
          modelKey: call.model.key,
        },
      ])
    }
  } catch (cause) {
    const persistFailure = cause instanceof PersistError
    logger.error(
      persistFailure ? 'steel_ai.persist_failed' : 'steel_ai.provider_failed',
      logFields(
        {
          component: 'SteelAiChatService',
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { model: call.model.key },
      ),
    )
    // What was consumed before the failure still counts against the quota.
    await AiUsageService.record(call, {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      usage,
      scope: {
        module: dominantModule(toolModules),
        conversationId: conversation.id,
      },
    })
    yield persistFailure
      ? { type: 'error', code: 'DATABASE_ERROR', message: PERSIST_ERROR }
      : {
          type: 'error',
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: PROVIDER_ERROR,
        }
    return
  }

  const reply = texts.join('\n\n')

  if (input.isFirstExchange && !conversation.title) {
    const title = await generateTitle(input, reply, usage)
    const won = await AiConversationRepository.setTitleIfEmpty(
      conversation.id,
      title,
    )
    if (won.ok && won.value) yield { type: 'conversation.title', title }
  }

  await AiUsageService.record(call, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    usage,
    scope: {
      module: dominantModule(toolModules),
      conversationId: conversation.id,
    },
  })
  // Keeps the user's pick even when this turn fell back to another model.
  const touched = await AiConversationRepository.update(conversation.id, {
    modelKey: input.storedModelKey ?? call.model.key,
  })
  if (!touched.ok) {
    logger.warn(
      'steel_ai.touch_failed',
      logFields({
        component: 'SteelAiChatService',
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
      }),
    )
  }

  logger.info(
    'steel_ai.turn_completed',
    logFields(
      {
        component: 'SteelAiChatService',
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
      },
      {
        mode: input.mode,
        model: call.model.key,
        tools: toolNames,
        pendingActions: pendingActions.length,
        autopilotActions: executedActions.length,
        simulatedActions: simulatedCount,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        maxToolSpecChars: maxSpecChars,
      },
    ),
  )

  const message: AiMessageDTO = {
    id: messageId,
    conversationId: conversation.id,
    role: 'ASSISTANT',
    content: reply,
    toolCalls,
    pendingActions: actions,
    attachments: [],
    createdAt: startedAt.toISOString(),
  }
  yield { type: 'message.end', message, usage: { ...usage } }
}

export const SteelAiChatService = {
  /**
   * What the chat screen may offer: the switches (AI, agent mode,
   * Autopilot), modules, the default and pickable models, attachment limits
   * and the quota. Answers even with the AI switched off (`aiEnabled: false`)
   * so the screen can explain why.
   */
  async capabilities(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiCapabilitiesDTO>> {
    const access = await resolveToolAccess(actorId, workspaceId)
    if (!access.ok) return access

    const [resolved, usage] = await Promise.all([
      AiUsageService.resolveModel(workspaceId, 'STEEL_ASSISTANT', actorId),
      AiUsageRepository.sumSince(workspaceId, currentPeriodStart()),
    ])
    if (!resolved.ok) return resolved
    if (!usage.ok) return usage

    const { aiEnabled, agentModeEnabled, autopilotEnabled } = access.value
    return ok({
      aiEnabled,
      agentModeEnabled,
      autopilotEnabled: agentModeEnabled && autopilotEnabled,
      modules: sortModules(access.value.modules),
      modelKey: aiEnabled ? (resolved.value.model?.key ?? null) : null,
      models: aiEnabled ? await chatModels(resolved.value.settings) : [],
      attachments: ATTACHMENT_LIMITS,
      quota: {
        usedUsd: Math.round(usage.value.costUsd * 100) / 100,
        quotaUsd: resolved.value.settings.monthlyQuotaUsd,
      },
    })
  },

  /**
   * Sends a user message and returns the turn as a stream of events.
   * Everything that can fail *before* the model is called (membership,
   * switches, conversation ownership, mode, attachments, provider/quota)
   * comes back as a Result error so the route answers with a JSON envelope;
   * once the stream starts, failures are `error` events.
   *
   * Model: the one asked in this message, else the conversation's pick,
   * else the user preference / workspace default — any of them that is no
   * longer usable is skipped (the pick stays saved on the conversation).
   */
  async sendMessage(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    input: SendAiMessageInput,
  ): Promise<Result<AsyncIterable<SteelAiStreamEvent>>> {
    const access = await resolveToolAccess(actorId, workspaceId)
    if (!access.ok) return access
    if (!access.value.aiEnabled) return err(aiDisabled())
    const content = input.content?.trim() ?? ''

    const conversation = await AiConversationRepository.findById(
      conversationId,
      workspaceId,
      actorId,
    )
    if (!conversation.ok) return conversation

    const mode: SteelAiMode = input.mode ?? conversation.value.mode
    const allowed = checkSteelAiMode(access.value, mode)
    if (!allowed.ok) return allowed

    const attachments = await AiAttachmentService.loadForSend(
      actorId,
      conversationId,
      input.attachmentIds ?? [],
    )
    if (!attachments.ok) return attachments

    const prepared = await AiUsageService.prepare(
      workspaceId,
      'STEEL_ASSISTANT',
      actorId,
      [input.modelKey, conversation.value.modelKey],
    )
    if (!prepared.ok) return prepared

    const ctx: AiToolContext = {
      workspaceId,
      actorId,
      source: 'assistant',
      conversationId,
    }
    const [user, workspace, preference, recent, invocation, catalog, memory] =
      await Promise.all([
        UserRepository.findById(actorId),
        WorkspaceRepository.findById(workspaceId),
        UserPreferenceRepository.findByUserId(actorId),
        AiMessageRepository.listRecent(conversationId, HISTORY_MAX_ROWS),
        resolveSkillInvocation(ctx, content),
        skillsCatalogForPrompt(ctx),
        memoryForPrompt(ctx),
      ])
    if (!user.ok) return user
    if (!workspace.ok) return workspace
    if (!recent.ok) return recent

    const changed: { mode?: SteelAiMode; modelKey?: string } = {}
    if (mode !== conversation.value.mode) changed.mode = mode
    // Only catalog keys are kept; anything else just falls back.
    if (
      input.modelKey &&
      input.modelKey !== conversation.value.modelKey &&
      findAiModel(input.modelKey)
    ) {
      changed.modelKey = input.modelKey
    }
    if (changed.mode || changed.modelKey) {
      const switched = await AiConversationRepository.update(
        conversationId,
        changed,
      )
      if (!switched.ok) return switched
      auditMutation({
        entity: 'ai_conversation',
        action: 'update',
        actorId,
        targetId: conversationId,
        meta: { workspaceId, fields: Object.keys(changed), ...changed },
      })
    }

    const saved = await AiMessageRepository.createMany([
      { conversationId, role: 'USER', content },
    ])
    if (!saved.ok) return saved
    if (attachments.value.length > 0) {
      const bound = await AiAttachmentRepository.attachToMessage(
        attachments.value.map((a) => a.id),
        saved.value[0].id,
      )
      if (!bound.ok) return bound
    }

    const capped = capHistory(recent.value)
    const notes = await AiAttachmentService.historyNotes(
      capped.filter((row) => row.role === 'USER').map((row) => row.id),
    )

    const skill = invocation.skill
    const modelText =
      skill && !invocation.content.trim()
        ? `Execute a skill /${skill.slug}.`
        : invocation.content
    const system = buildSteelAiSystemPrompt({
      userName: user.value.name,
      workspaceName: workspace.value.name,
      now: new Date(),
      timezone: preference.ok ? preference.value.timezone : DEFAULT_TIMEZONE,
      modules: access.value.modules,
      mode,
      sections: [skill ? skillSection(skill) : '', catalog, memory],
    })

    return ok(
      runTurn({
        actorId,
        workspaceId,
        conversation: conversation.value,
        mode,
        access: access.value,
        call: prepared.value,
        system,
        history: toProviderHistory(
          capped,
          buildUserContent(modelText, attachments.value),
          notes,
        ),
        content: modelText,
        titleSource:
          content || attachments.value.map((a) => a.filename).join(', '),
        storedModelKey: changed.modelKey ?? conversation.value.modelKey ?? null,
        isFirstExchange: !recent.value.some((row) => row.role === 'USER'),
        pinnedTools: pinnedToolsFromHistory(capped),
        previousMessages: capped
          .filter((row) => row.role === 'USER')
          .map((row) => row.content)
          .reverse(),
      }),
    )
  },
}
