import {
  type AiPendingAction,
  Prisma,
  type SteelAgentRunStatus,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { currentPeriodStart } from '@/src/lib/ai/quota'
import {
  type AiToolAccess,
  availableTools,
  findTool,
  proposeWriteTool,
  resolveToolAccess,
  runReadTool,
  runTool,
  simulateWriteTool,
  toToolSpecs,
} from '@/src/lib/ai/tools/registry'
import { serializeToolResult } from '@/src/lib/ai/tools/tool-result'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type { AiMessage, AiToolCall, AiUsageTokens } from '@/src/lib/ai/types'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildSteelAgentDecisionMessage,
  buildSteelAgentSystemPrompt,
  buildSteelAgentTriggerMessage,
} from '@/src/lib/steel-agents/prompt'
import { runInSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import {
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
  type SteelAgentRunWithAgent,
} from '@/src/repositories/steel-agent.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { AiToolPreviewDTO } from '@/types/steel-ai'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import {
  notifyAgentApprovalRequested,
  notifyAgentRunFailed,
} from './steel-agent-notifications'

/**
 * Executes a Steel Agent run (worker job `steel-agents/run`). Same loop as
 * the Steel AI chat, without streaming: READ tools run; writes run on their
 * own only when the agent marks them AUTO (never DELETE); every other write
 * becomes an AiPendingAction and the run pauses on WAITING_APPROVAL with
 * its transcript in `state`. After the human decisions the same job resumes
 * it. Everything runs with the owner's permissions; the domain services
 * remain the authority. Never throws.
 *
 * Test runs (`isTest`, "Testar agente"): reads run for real, every write —
 * AUTO or APPROVAL — is simulated from its preview (`simulateWriteTool`),
 * so no AiPendingAction, no inbox approval, no message sent and no failure
 * notification; the pause switch, the agent-mode switch and the monthly cap
 * do not apply (nothing is written and the run does not count).
 */

/** Agent approvals happen in the inbox, so they live longer than chat ones. */
export const STEEL_AGENT_APPROVAL_TTL_MS = 72 * 60 * 60_000

const PENDING_NOTE =
  'Ação registrada e aguardando aprovação humana. Não chame esta ferramenta de novo; siga com o resto da tarefa ou encerre com um resumo.'
const ROUND_LIMIT_NOTE =
  'Limite de etapas desta execução atingido; a ferramenta não foi executada. Encerre com um resumo do que já fez.'
const EMPTY_SUMMARY = 'Execução concluída sem resposta do modelo.'
const PROVIDER_ERROR = 'Falha ao falar com o provedor de IA'

export type SteelAgentRunOutcome =
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting'
  | 'noop'

/** What a paused run needs to resume exactly. */
export interface SteelAgentRunState {
  messages: AiMessage[]
  round: number
  /** Actions proposed in the round that paused the run. */
  pendingActionIds: string[]
}

function parseState(value: unknown): SteelAgentRunState {
  const state = (value ?? {}) as Partial<SteelAgentRunState>
  return {
    messages: Array.isArray(state.messages) ? state.messages : [],
    round: typeof state.round === 'number' ? state.round : 0,
    pendingActionIds: Array.isArray(state.pendingActionIds)
      ? state.pendingActionIds
      : [],
  }
}

function errorContent(code: string, message: string): string {
  return serializeToolResult({ status: 'error', error: { code, message } })
}

type Preflight =
  | { kind: 'skip'; reason: string }
  | { kind: 'fail'; error: string }
  | {
      kind: 'go'
      access: AiToolAccess
      call: PreparedAiCall
      tools: AnySteelAiTool[]
    }

/** Kill switches, checked on start and on every resume. */
async function preflight(
  run: SteelAgentRunWithAgent,
  starting: boolean,
): Promise<Preflight> {
  const { agent } = run
  if (!agent.enabled && !run.isTest) {
    return { kind: 'skip', reason: 'O agente está pausado.' }
  }
  if (!agent.ownerId) {
    return { kind: 'skip', reason: 'O agente está sem responsável.' }
  }

  const access = await resolveToolAccess(agent.ownerId, run.workspaceId)
  if (!access.ok) {
    if (access.error.code === 'FORBIDDEN') {
      return {
        kind: 'skip',
        reason: 'O responsável pelo agente não é mais membro do workspace.',
      }
    }
    if (access.error.code === 'WORKSPACE_SUSPENDED') {
      return { kind: 'skip', reason: 'O workspace está suspenso.' }
    }
    return { kind: 'fail', error: access.error.message }
  }
  if (!access.value.aiEnabled) {
    return { kind: 'skip', reason: 'O Steel AI está desligado no workspace.' }
  }
  if (!access.value.agentsEnabled) {
    return {
      kind: 'skip',
      reason: 'Os Steel Agents estão desligados no workspace.',
    }
  }

  const configured = agent.tools
    .map((t) => findTool(t.toolName))
    .filter((tool): tool is AnySteelAiTool => Boolean(tool))
  const hasWrites = configured.some((tool) => tool.kind !== 'READ')
  if (hasWrites && !access.value.agentModeEnabled && !run.isTest) {
    return {
      kind: 'skip',
      reason:
        'O modo agente (escritas da IA) está desligado no workspace; o agente não roda enquanto ele estiver desligado.',
    }
  }

  if (starting && agent.monthlyRunCap && !run.isTest) {
    // This QUEUED run is part of the count.
    const count = await SteelAgentRunRepository.countSince(
      agent.id,
      currentPeriodStart(),
    )
    if (!count.ok) return { kind: 'fail', error: count.error.message }
    if (count.value > agent.monthlyRunCap) {
      return {
        kind: 'skip',
        reason: `Limite mensal de ${agent.monthlyRunCap} execuções atingido.`,
      }
    }
  }

  const call = await AiUsageService.prepare(
    run.workspaceId,
    'STEEL_AGENT',
    null,
  )
  if (!call.ok) {
    if (call.error.code === 'AI_QUOTA_EXCEEDED') {
      return {
        kind: 'skip',
        reason: 'A cota mensal de IA do workspace acabou.',
      }
    }
    if (call.error.code === 'AI_PROVIDER_UNAVAILABLE') {
      return {
        kind: 'skip',
        reason: 'Nenhum modelo de IA disponível no workspace.',
      }
    }
    return { kind: 'fail', error: call.error.message }
  }

  const allowedNames = new Set(agent.tools.map((t) => t.toolName))
  const tools = availableTools(
    access.value,
    run.isTest ? 'TEST' : 'AGENT',
  ).filter((tool) => allowedNames.has(tool.name))
  return { kind: 'go', access: access.value, call: call.value, tools }
}

async function finish(
  run: SteelAgentRunWithAgent,
  from: SteelAgentRunStatus[],
  status: 'SKIPPED' | 'FAILED',
  message: string,
): Promise<void> {
  const done = await SteelAgentRunRepository.claim(run.id, from, {
    status,
    finishedAt: new Date(),
    state: Prisma.DbNull,
    ...(status === 'SKIPPED' ? { summary: message } : { error: message }),
  })
  if (!done.ok) return
  logger.warn(
    status === 'SKIPPED'
      ? 'steel_agents.run_skipped'
      : 'steel_agents.run_failed',
    logFields(
      { component: 'SteelAgentRunner', workspaceId: run.workspaceId },
      { agentId: run.agentId, runId: run.id, reason: message },
    ),
  )
  // A test run is watched by whoever started it: no failure notification.
  if (status === 'FAILED' && done.value && !run.isTest) {
    await notifyAgentRunFailed({
      workspaceId: run.workspaceId,
      agentId: run.agentId,
      agentName: run.agent.name,
      ownerId: run.agent.ownerId,
      createdById: run.agent.createdById,
      runId: run.id,
      error: message,
    })
  }
}

/** Human decisions on the actions of the round that paused the run. */
function decisionsOf(actions: AiPendingAction[], ids: string[]) {
  const wanted = new Set(ids)
  return actions
    .filter((action) => wanted.size === 0 || wanted.has(action.id))
    .map((action) => {
      const preview = action.preview as unknown as AiToolPreviewDTO
      const result = action.result as { summary?: unknown } | null
      return {
        title: preview?.title ?? action.toolName,
        status: action.status,
        resultSummary:
          typeof result?.summary === 'string' ? result.summary : null,
        error: action.error,
      }
    })
}

async function promptContext(
  run: SteelAgentRunWithAgent,
  access: AiToolAccess,
) {
  const [workspace, owner] = await Promise.all([
    WorkspaceRepository.findById(run.workspaceId),
    UserRepository.findById(run.agent.ownerId as string),
  ])
  return buildSteelAgentSystemPrompt({
    agentName: run.agent.name,
    instructions: run.agent.instructions,
    workspaceName: workspace.ok ? workspace.value.name : 'Workspace',
    ownerName: owner.ok ? owner.value.name : 'Responsável',
    now: new Date(),
    timezone: run.agent.timezone,
    modules: access.modules,
  })
}

export async function executeSteelAgentRun(
  runId: string,
): Promise<Result<SteelAgentRunOutcome>> {
  const loaded = await SteelAgentRunRepository.findForExecution(runId)
  if (!loaded.ok) return loaded
  const run = loaded.value
  const { agent } = run

  let starting: boolean
  if (run.status === 'QUEUED') {
    starting = true
  } else if (run.status === 'WAITING_APPROVAL') {
    starting = false
    const actions = await SteelAgentRunRepository.listActions(run.id)
    if (!actions.ok) return actions
    if (actions.value.some((action) => action.status === 'PENDING')) {
      return ok('waiting')
    }
  } else {
    return ok('noop')
  }
  const from: SteelAgentRunStatus[] = [run.status]

  const checked = await preflight(run, starting)
  if (checked.kind === 'skip') {
    await finish(run, from, 'SKIPPED', checked.reason)
    return ok('skipped')
  }
  if (checked.kind === 'fail') {
    await finish(run, from, 'FAILED', checked.error)
    return ok('failed')
  }
  const { access, call, tools } = checked

  const claimed = await SteelAgentRunRepository.claim(run.id, from, {
    status: 'RUNNING',
    modelKey: call.model.key,
    ...(starting && { startedAt: new Date() }),
  })
  if (!claimed.ok) return claimed
  if (!claimed.value) return ok('noop')

  const state = starting
    ? {
        messages: [
          {
            role: 'user',
            content: buildSteelAgentTriggerMessage({
              triggerType: run.triggerType,
              payload: run.triggerPayload,
              eventKey: agent.eventKey,
            }),
          },
        ] as AiMessage[],
        round: 0,
        pendingActionIds: [] as string[],
      }
    : parseState(run.state)

  if (!starting) {
    const actions = await SteelAgentRunRepository.listActions(run.id)
    if (!actions.ok) return actions
    state.messages.push({
      role: 'user',
      content: buildSteelAgentDecisionMessage(
        decisionsOf(actions.value, state.pendingActionIds),
      ),
    })
    state.pendingActionIds = []
  }

  const system = await promptContext(run, access)
  const specs = toToolSpecs(tools)
  const modeOf = new Map(agent.tools.map((t) => [t.toolName, t.mode]))
  const ctx: AiToolContext = {
    workspaceId: run.workspaceId,
    actorId: agent.ownerId as string,
    source: 'agent',
    agentId: agent.id,
  }
  const usage: AiUsageTokens = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  }
  let roundsThisPass = 0
  let lastText = ''

  const step = async (
    data: Parameters<typeof SteelAgentRunStepRepository.create>[0],
  ) => {
    const saved = await SteelAgentRunStepRepository.create(data)
    if (!saved.ok) {
      logger.warn(
        'steel_agents.step_failed',
        logFields(
          { component: 'SteelAgentRunner', message: saved.error.message },
          { runId: run.id },
        ),
      )
    }
  }

  /** Runs one tool call; returns the content for the model. */
  const handleCall = async (
    toolCall: AiToolCall,
    forceText: boolean,
  ): Promise<string> => {
    const input = toolCall.arguments as Prisma.InputJsonValue
    const base = {
      runId: run.id,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      input,
    }
    if (forceText) {
      await step({
        ...base,
        kind: 'TOOL',
        status: 'FAILED',
        error: ROUND_LIMIT_NOTE,
      })
      return errorContent('ROUND_LIMIT', ROUND_LIMIT_NOTE)
    }
    const tool = tools.find((t) => t.name === toolCall.name)
    if (!tool) {
      const message = 'Ferramenta não permitida para este agente'
      await step({ ...base, kind: 'TOOL', status: 'FAILED', error: message })
      return errorContent('AI_TOOL_NOT_ALLOWED', message)
    }

    if (tool.kind === 'READ') {
      const result = await runReadTool(tool, ctx, toolCall.arguments)
      await step({
        ...base,
        kind: 'TOOL',
        status: result.ok ? 'OK' : 'FAILED',
        ...(result.ok
          ? { output: { summary: result.output.summary } }
          : { error: result.error.message }),
      })
      return result.content
    }

    if (run.isTest) {
      const simulated = await simulateWriteTool(tool, ctx, toolCall.arguments, {
        actorId: run.startedById,
      })
      await step({
        ...base,
        kind: 'TOOL',
        status: simulated.ok ? 'SIMULATED' : 'FAILED',
        ...(simulated.ok
          ? {
              output: {
                title: simulated.simulation.preview.title,
                simulation: simulated.simulation,
              } as unknown as Prisma.InputJsonValue,
            }
          : { error: simulated.error.message }),
      })
      return simulated.content
    }

    const mode = effectiveToolMode(
      tool.kind,
      modeOf.get(tool.name) ?? 'APPROVAL',
    )
    // Third-party content tried to instruct the model in this run (ADR
    // 0041): even an AUTO write waits for a human approval in the inbox.
    if (mode === 'AUTO' && !call.guard?.tainted()) {
      const result = await runInSteelAgentContext(
        { agentId: agent.id, runId: run.id },
        () => runTool(tool, ctx, toolCall.arguments),
      )
      const target = result.ok ? result.output.target : undefined
      const log = await AiActionLogRepository.create({
        workspaceId: run.workspaceId,
        source: 'AGENT',
        actorId: null,
        agentId: agent.id,
        toolName: tool.name,
        kind: tool.kind,
        module: tool.module,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        args: input,
        outcome: result.ok ? 'success' : 'failure',
        summary: result.ok ? result.output.summary : null,
        error: result.ok ? null : result.error.message,
      })
      if (!log.ok) {
        logger.error(
          'steel_agents.action_log_failed',
          logFields(
            { component: 'SteelAgentRunner', message: log.error.message },
            { runId: run.id },
          ),
        )
      }
      auditMutation({
        entity: 'steel_agent_run',
        action: 'update',
        actorId: null,
        targetId: run.id,
        outcome: result.ok ? 'success' : 'failure',
        ...(!result.ok && { reason: result.error.code }),
        meta: {
          workspaceId: run.workspaceId,
          agentId: agent.id,
          ownerId: agent.ownerId,
          toolName: tool.name,
          kind: tool.kind,
          mode: 'AUTO',
          targetType: target?.type,
          targetRecordId: target?.id,
        },
      })
      await step({
        ...base,
        kind: 'TOOL',
        status: result.ok ? 'OK' : 'FAILED',
        ...(result.ok
          ? {
              output: {
                summary: result.output.summary,
                ...(target && { target }),
              } as Prisma.InputJsonValue,
            }
          : { error: result.error.message }),
      })
      return result.content
    }

    const proposed = await proposeWriteTool(tool, ctx, toolCall.arguments, {
      agentRunId: run.id,
      toolCallId: toolCall.id,
      ttlMs: STEEL_AGENT_APPROVAL_TTL_MS,
    })
    if (!proposed.ok) {
      await step({
        ...base,
        kind: 'TOOL',
        status: 'FAILED',
        error: proposed.error.message,
      })
      return errorContent(proposed.error.code, proposed.error.message)
    }
    state.pendingActionIds.push(proposed.value.id)
    const preview = proposed.value.preview as unknown as AiToolPreviewDTO
    await step({
      ...base,
      kind: 'APPROVAL',
      status: 'PENDING',
      pendingActionId: proposed.value.id,
      output: { title: preview.title },
    })
    return serializeToolResult({
      status: 'pending_confirmation',
      actionId: proposed.value.id,
      summary: preview.title,
      note: PENDING_NOTE,
    })
  }

  const totals = () => ({
    rounds: { increment: roundsThisPass },
    inputTokens: { increment: usage.inputTokens },
    outputTokens: { increment: usage.outputTokens },
    costUsd: { increment: AiUsageService.price(call, usage) },
  })
  const record = () =>
    AiUsageService.record(call, {
      workspaceId: run.workspaceId,
      userId: null,
      usage,
    })

  try {
    while (state.round < agent.maxToolRounds) {
      const forceText = state.round === agent.maxToolRounds - 1
      const response = await call.provider.chat({
        model: call.model.model,
        system,
        messages: state.messages,
        ...(specs.length > 0 && {
          tools: specs,
          toolChoice: forceText ? ('none' as const) : ('auto' as const),
        }),
      })
      state.round++
      roundsThisPass++
      usage.inputTokens += response.usage.inputTokens
      usage.outputTokens += response.usage.outputTokens
      usage.cachedInputTokens =
        (usage.cachedInputTokens ?? 0) + (response.usage.cachedInputTokens ?? 0)
      if (response.text) lastText = response.text
      await step({
        runId: run.id,
        kind: 'MODEL',
        status: 'OK',
        output: {
          text: response.text.slice(0, 4_000),
          toolCalls: response.toolCalls.map((c) => c.name),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      })

      state.messages.push(response.message)
      for (const toolCall of response.toolCalls) {
        const content = await handleCall(toolCall, forceText)
        state.messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          name: toolCall.name,
          content,
        })
      }

      if (state.pendingActionIds.length > 0) {
        await SteelAgentRunRepository.update(run.id, {
          status: 'WAITING_APPROVAL',
          state: state as unknown as Prisma.InputJsonValue,
          ...(lastText && { summary: lastText }),
          ...totals(),
        })
        await record()
        await notifyAgentApprovalRequested({
          workspaceId: run.workspaceId,
          agentId: agent.id,
          agentName: agent.name,
          ownerId: agent.ownerId,
          runId: run.id,
          round: state.round,
          count: state.pendingActionIds.length,
        })
        logger.info(
          'steel_agents.run_waiting',
          logFields(
            { component: 'SteelAgentRunner', workspaceId: run.workspaceId },
            {
              agentId: agent.id,
              runId: run.id,
              pendingActions: state.pendingActionIds.length,
            },
          ),
        )
        return ok('waiting')
      }
      if (response.toolCalls.length === 0 || forceText) break
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    logger.error(
      'steel_agents.provider_failed',
      logFields(
        {
          component: 'SteelAgentRunner',
          workspaceId: run.workspaceId,
          message,
        },
        { agentId: agent.id, runId: run.id },
      ),
    )
    await SteelAgentRunRepository.update(run.id, {
      status: 'FAILED',
      error: `${PROVIDER_ERROR}: ${message}`.slice(0, 2_000),
      finishedAt: new Date(),
      state: Prisma.DbNull,
      ...totals(),
    })
    await record()
    if (!run.isTest) {
      await notifyAgentRunFailed({
        workspaceId: run.workspaceId,
        agentId: agent.id,
        agentName: agent.name,
        ownerId: agent.ownerId,
        createdById: agent.createdById,
        runId: run.id,
        error: PROVIDER_ERROR,
      })
    }
    return ok('failed')
  }

  const saved = await SteelAgentRunRepository.update(run.id, {
    status: 'SUCCEEDED',
    summary: lastText || EMPTY_SUMMARY,
    finishedAt: new Date(),
    state: Prisma.DbNull,
    ...totals(),
  })
  await record()
  if (!saved.ok) return err(saved.error)

  logger.info(
    'steel_agents.run_succeeded',
    logFields(
      { component: 'SteelAgentRunner', workspaceId: run.workspaceId },
      {
        agentId: agent.id,
        runId: run.id,
        test: run.isTest,
        rounds: state.round,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    ),
  )
  return ok('succeeded')
}
