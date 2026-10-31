import {
  type AiPendingAction,
  Prisma,
  type Role,
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
  isToolAllowed,
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
  buildDelegationTriggerMessage,
  DELEGATE_TOOL_NAME,
  DELEGATION_REFUSAL_MESSAGE,
  type DelegateTarget,
  delegateToolSpec,
  delegationRefusal,
  MAX_DELEGATION_DEPTH,
  MAX_DELEGATION_RESULT_CHARS,
  parseDelegateArgs,
} from '@/src/lib/steel-agents/delegation'
import {
  canRoleRunAuto,
  type SteelAgentPolicyLike,
} from '@/src/lib/steel-agents/policy'
import {
  buildSteelAgentDecisionMessage,
  buildSteelAgentSystemPrompt,
  buildSteelAgentTriggerMessage,
} from '@/src/lib/steel-agents/prompt'
import { runInSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import {
  contextExcerpt,
  diffGuard,
  GUARDRAIL_RULE_LABEL,
  type GuardrailRule,
  guardrailOutput,
  snapshotGuard,
} from '@/src/lib/steel-agents/trace'
import {
  parseVersionTools,
  pickVersionId,
} from '@/src/lib/steel-agents/versions'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentDelegateRepository,
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
  type SteelAgentRunWithAgent,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentPolicyRepository } from '@/src/repositories/steel-agent-governance.repository'
import { SteelAgentVersionRepository } from '@/src/repositories/steel-agent-version.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { AiToolPreviewDTO } from '@/types/steel-ai'
import { AiProcedureRuntime } from './ai-procedure-runtime.service'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import {
  notifyAgentApprovalRequested,
  notifyAgentRunFailed,
} from './steel-agent-notifications'
import { loadMcpAgentTools } from './steel-mcp-tools'

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

/** Task and caller of a delegated run (A7); null for ordinary runs. */
function delegatedTask(
  run: SteelAgentRunWithAgent,
): { parentAgentName: string; task: string } | null {
  if (!run.parentRunId) return null
  const payload = run.triggerPayload as {
    task?: unknown
    delegatedBy?: { agentName?: unknown }
  } | null
  if (typeof payload?.task !== 'string') return null
  return {
    parentAgentName:
      typeof payload.delegatedBy?.agentName === 'string'
        ? payload.delegatedBy.agentName
        : 'outro agente',
    task: payload.task,
  }
}

const PENDING_NOTE =
  'Ação registrada e aguardando aprovação humana. Não chame esta ferramenta de novo; siga com o resto da tarefa ou encerre com um resumo.'
const ROUND_LIMIT_NOTE =
  'Limite de etapas desta execução atingido; a ferramenta não foi executada. Encerre com um resumo do que já fez.'
const EMPTY_SUMMARY = 'Execução concluída sem resposta do modelo.'
const PROVIDER_ERROR = 'Falha ao falar com o provedor de IA'
const KILL_SWITCH_NOTE =
  'Os agentes do workspace estão pausados por emergência.'

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
      /** A8: governance policy and the owner's role (AUTO rules). */
      policy: SteelAgentPolicyLike | null
      ownerRole: Role | null
      /** A7: agents this run may delegate to. */
      delegates: DelegateTarget[]
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

  // A6: emergency switch. Test runs write nothing, so they may still run.
  const policy = await SteelAgentPolicyRepository.find(run.workspaceId)
  if (!policy.ok) return { kind: 'fail', error: policy.error.message }
  if (policy.value?.killedAt && !run.isTest) {
    return { kind: 'skip', reason: KILL_SWITCH_NOTE }
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

  const mcp = await loadMcpAgentTools(run.workspaceId)
  if (!mcp.ok) return { kind: 'fail', error: mcp.error.message }
  const configured = agent.tools
    .map(
      (t) =>
        findTool(t.toolName) ?? mcp.value.find((m) => m.name === t.toolName),
    )
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
  const mode = run.isTest ? 'TEST' : 'AGENT'
  const tools = [
    ...availableTools(access.value, mode),
    ...mcp.value.filter((tool) => isToolAllowed(tool, access.value, mode)),
  ].filter((tool) => allowedNames.has(tool.name))

  let ownerRole: Role | null = null
  if (policy.value?.restrictAuto) {
    const membership = await MembershipRepository.findByUserAndWorkspace(
      agent.ownerId,
      run.workspaceId,
    )
    if (!membership.ok) return { kind: 'fail', error: membership.error.message }
    ownerRole = membership.value?.role ?? null
  }

  let delegates: DelegateTarget[] = []
  if (run.depth < MAX_DELEGATION_DEPTH) {
    const targets = await SteelAgentDelegateRepository.listTargets(agent.id)
    if (!targets.ok) return { kind: 'fail', error: targets.error.message }
    delegates = targets.value
      .filter((target) => target.enabled)
      .map(({ id, name, description }) => ({ id, name, description }))
  }
  return {
    kind: 'go',
    access: access.value,
    call: call.value,
    tools,
    policy: policy.value,
    ownerRole,
    delegates,
  }
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

/**
 * A2: a run executes the version recorded on it. A new real run is assigned
 * on start (A/B split between the published version and the challenger) and
 * the version's snapshot overlays the agent's instructions, tools and round
 * cap. Test runs and agents without versions use the agent as it is. Never
 * fails the run: a missing version falls back to the agent's own fields.
 */
async function withVersion(
  run: SteelAgentRunWithAgent,
  starting: boolean,
): Promise<SteelAgentRunWithAgent> {
  const { agent } = run
  let versionId = run.versionId
  if (!versionId && starting && !run.isTest) {
    let challenger: { id: string; percent: number } | null = null
    if (agent.challengerVersionId) {
      const found = await SteelAgentVersionRepository.findByIdUnscoped(
        agent.challengerVersionId,
      )
      if (
        found.ok &&
        found.value?.status === 'CHALLENGER' &&
        found.value.rolloutPercent
      ) {
        challenger = {
          id: found.value.id,
          percent: found.value.rolloutPercent,
        }
      }
    }
    versionId = pickVersionId({
      publishedId: agent.publishedVersionId,
      challenger,
    })
    if (versionId) {
      await SteelAgentRunRepository.update(run.id, { versionId })
    }
  }
  if (!versionId) return run
  if (versionId === agent.publishedVersionId) return { ...run, versionId }

  const found = await SteelAgentVersionRepository.findByIdUnscoped(versionId)
  if (!found.ok || !found.value) return { ...run, versionId }
  const version = found.value
  return {
    ...run,
    versionId,
    agent: {
      ...agent,
      instructions: version.instructions,
      maxToolRounds: version.maxToolRounds,
      tools: parseVersionTools(version.tools).map((tool) => ({
        id: `${version.id}:${tool.toolName}`,
        agentId: agent.id,
        toolName: tool.toolName,
        mode: tool.mode,
        createdAt: version.createdAt,
      })),
    },
  }
}

export async function executeSteelAgentRun(
  runId: string,
): Promise<Result<SteelAgentRunOutcome>> {
  const loaded = await SteelAgentRunRepository.findForExecution(runId)
  if (!loaded.ok) return loaded
  const run = await withVersion(loaded.value, loaded.value.status === 'QUEUED')
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
  const { access, call, tools, policy, ownerRole, delegates } = checked

  const claimed = await SteelAgentRunRepository.claim(run.id, from, {
    status: 'RUNNING',
    modelKey: call.model.key,
    ...(starting && { startedAt: new Date() }),
  })
  if (!claimed.ok) return claimed
  if (!claimed.value) return ok('noop')

  const delegated = delegatedTask(run)
  const state = starting
    ? {
        messages: [
          {
            role: 'user',
            content: delegated
              ? buildDelegationTriggerMessage(delegated)
              : buildSteelAgentTriggerMessage({
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
  const specs = [
    ...toToolSpecs(tools),
    ...(delegates.length > 0 ? [delegateToolSpec(delegates)] : []),
  ]
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
  /** A7: cost of the child runs started in this pass (billed to this run). */
  let delegatedCost = 0
  let delegationsStarted = 0

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

  let guardSeen = snapshotGuard(call.guard?.report)
  /** A guardrail rule that acted in this run becomes a timeline step. */
  const guardrail = (
    rule: GuardrailRule,
    detail: string,
    extra?: Record<string, unknown>,
    toolName?: string,
  ) =>
    step({
      runId: run.id,
      kind: 'GUARDRAIL',
      status: 'OK',
      ...(toolName && { toolName }),
      output: guardrailOutput(rule, detail, {
        title: GUARDRAIL_RULE_LABEL[rule],
        ...extra,
      }) as Prisma.InputJsonValue,
    })
  /** Records what the call guard (PII, injection, failover) did since last look. */
  const recordGuard = async () => {
    const diff = diffGuard(guardSeen, call.guard?.report)
    guardSeen = diff.snapshot
    for (const event of diff.events) {
      await step({
        runId: run.id,
        kind: 'GUARDRAIL',
        status: 'OK',
        output: {
          ...event,
          title: GUARDRAIL_RULE_LABEL[event.rule],
        } as Prisma.InputJsonValue,
      })
    }
  }

  /** A7: runs another agent as a child run, inline, and reports back. */
  const handleDelegation = async (toolCall: AiToolCall): Promise<string> => {
    const input = toolCall.arguments as Prisma.InputJsonValue
    const base = {
      runId: run.id,
      toolName: DELEGATE_TOOL_NAME,
      toolCallId: toolCall.id,
      input,
    }
    const refuse = async (message: string, rule = true) => {
      if (rule) {
        await guardrail(
          'DELEGATION_REFUSED',
          message,
          undefined,
          DELEGATE_TOOL_NAME,
        )
      }
      await step({ ...base, kind: 'TOOL', status: 'FAILED', error: message })
      return errorContent('AI_DELEGATION_REFUSED', message)
    }
    const parsed = parseDelegateArgs(toolCall.arguments)
    const target = parsed && delegates.find((d) => d.id === parsed.agentId)
    if (!parsed || !target) {
      return refuse(
        'Agente de destino inválido ou fora da sua lista de delegação.',
      )
    }
    const chain = await SteelAgentDelegateRepository.runChain(run.id)
    const refusal = delegationRefusal({
      depth: run.depth,
      chain: chain.ok ? chain.value : [agent.id],
      targetId: target.id,
      delegationsSoFar: delegationsStarted,
    })
    if (refusal) return refuse(DELEGATION_REFUSAL_MESSAGE[refusal])
    delegationsStarted++

    const created = await SteelAgentRunRepository.create({
      workspaceId: run.workspaceId,
      agentId: target.id,
      triggerType: 'MANUAL',
      triggerPayload: {
        task: parsed.task,
        delegatedBy: {
          agentId: agent.id,
          agentName: agent.name,
          runId: run.id,
        },
      },
      startedById: run.startedById,
      isTest: run.isTest,
      parentRunId: run.id,
      depth: run.depth + 1,
    })
    if (!created.ok) return refuse(created.error.message, false)

    const outcome = await executeSteelAgentRun(created.value.id)
    const child = await SteelAgentRunRepository.findForExecution(
      created.value.id,
    )
    const childRun = child.ok ? child.value : null
    delegatedCost += Number(childRun?.costUsd ?? 0)
    const status = childRun?.status ?? 'FAILED'
    const text = (
      childRun?.summary ??
      childRun?.error ??
      (outcome.ok ? '' : outcome.error.message)
    ).slice(0, MAX_DELEGATION_RESULT_CHARS)
    const succeeded = status === 'SUCCEEDED' || status === 'WAITING_APPROVAL'
    await step({
      ...base,
      kind: 'TOOL',
      status: succeeded ? 'OK' : 'FAILED',
      ...(succeeded ? {} : { error: text || 'A delegação não foi concluída.' }),
      output: {
        title: `Delegou a “${target.name}”`,
        childRunId: created.value.id,
        childAgentId: target.id,
        childAgentName: target.name,
        childStatus: status,
        costUsd: Number(childRun?.costUsd ?? 0),
        summary: text.slice(0, 600),
      } as Prisma.InputJsonValue,
    })
    if (!succeeded) {
      return errorContent(
        'AI_DELEGATION_FAILED',
        text || `O agente "${target.name}" não concluiu a tarefa.`,
      )
    }
    return serializeToolResult({
      status: 'done',
      summary: `${target.name} concluiu a tarefa`,
      data: {
        agente: target.name,
        situacao:
          status === 'WAITING_APPROVAL'
            ? 'Propôs ações que aguardam aprovação humana; elas ainda não foram executadas.'
            : 'Concluída',
        resumo: text,
      },
    })
  }

  // A5: procedures linked to this agent (null = none, behavior unchanged).
  const procedureStart = await AiProcedureRuntime.beginTurn({
    workspaceId: run.workspaceId,
    subjectType: run.isTest ? 'TEST' : 'STEEL_AGENT_RUN',
    subjectId: run.id,
    channel: 'AGENT',
    agentId: agent.id,
    simulate: run.isTest,
    onEvent: async (event) => {
      await step({
        runId: run.id,
        kind: 'PROCEDURE',
        status:
          event.status === 'FAILED' || event.status === 'REJECTED'
            ? 'FAILED'
            : 'OK',
        toolName: event.stepKey,
        ...(event.input !== undefined && {
          input: event.input as Prisma.InputJsonValue,
        }),
        output: {
          title: event.title,
          stepKind: event.kind,
          stepStatus: event.status,
          ...((event.output as Record<string, unknown> | undefined) ?? {}),
        } as Prisma.InputJsonValue,
        ...(event.error && { error: event.error }),
      })
    },
  })
  const procedureTurn = procedureStart.ok ? procedureStart.value : null

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
      await guardrail(
        'ROUND_LIMIT',
        `A execução chegou ao limite de ${agent.maxToolRounds} etapas; a ferramenta não foi executada e o agente foi orientado a encerrar.`,
        { maxToolRounds: agent.maxToolRounds },
        toolCall.name,
      )
      await step({
        ...base,
        kind: 'TOOL',
        status: 'FAILED',
        error: ROUND_LIMIT_NOTE,
      })
      return errorContent('ROUND_LIMIT', ROUND_LIMIT_NOTE)
    }
    if (toolCall.name === DELEGATE_TOOL_NAME && delegates.length > 0) {
      return handleDelegation(toolCall)
    }
    if (procedureTurn?.owns(toolCall.name)) {
      return procedureTurn.handle(toolCall)
    }
    const tool = tools.find((t) => t.name === toolCall.name)
    if (!tool) {
      const message = 'Ferramenta não permitida para este agente'
      await guardrail(
        'TOOL_NOT_ALLOWED',
        'O modelo pediu uma ferramenta que não está na lista deste agente; nada foi executado.',
        undefined,
        toolCall.name,
      )
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
          ? {
              output: {
                summary: result.output.summary,
                // The retrieved context the model reasoned over.
                context: contextExcerpt(result.content),
              } as Prisma.InputJsonValue,
            }
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

    const configuredMode = modeOf.get(tool.name) ?? 'APPROVAL'
    let mode = effectiveToolMode(tool.kind, configuredMode)
    if (configuredMode === 'AUTO' && mode === 'APPROVAL') {
      await guardrail(
        'DELETE_NEEDS_APPROVAL',
        'Exclusões nunca rodam sozinhas: a ação foi enviada para aprovação humana.',
        undefined,
        tool.name,
      )
    }
    // A8: the owner's role has to allow this tool in AUTO under the policy.
    if (
      mode === 'AUTO' &&
      policy?.restrictAuto &&
      !canRoleRunAuto(policy, ownerRole ?? 'VIEWER', tool.name)
    ) {
      await guardrail(
        'AUTO_ROLE_RESTRICTED',
        'O perfil do responsável não libera esta ferramenta no modo automático; a ação foi enviada para aprovação humana.',
        undefined,
        tool.name,
      )
      mode = 'APPROVAL'
    }
    // Third-party content tried to instruct the model in this run (ADR
    // 0041): even an AUTO write waits for a human approval in the inbox.
    if (mode === 'AUTO' && call.guard?.tainted()) {
      await guardrail(
        'AUTO_NEEDS_APPROVAL',
        'Esta ferramenta roda sozinha, mas um conteúdo de terceiros tentou instruir o modelo nesta execução; a ação foi para aprovação humana.',
        undefined,
        tool.name,
      )
    }
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
    costUsd: { increment: AiUsageService.price(call, usage) + delegatedCost },
    ...(delegatedCost > 0 && {
      delegatedCostUsd: { increment: delegatedCost },
    }),
  })
  const record = () =>
    AiUsageService.record(call, {
      workspaceId: run.workspaceId,
      userId: null,
      usage,
    })

  try {
    while (state.round < agent.maxToolRounds) {
      if (!run.isTest && state.round > 0) {
        const live = await SteelAgentPolicyRepository.find(run.workspaceId)
        if (live.ok && live.value?.killedAt) {
          await guardrail('KILL_SWITCH', KILL_SWITCH_NOTE)
          await SteelAgentRunRepository.update(run.id, {
            status: 'SKIPPED',
            summary: KILL_SWITCH_NOTE,
            finishedAt: new Date(),
            state: Prisma.DbNull,
            ...totals(),
          })
          await record()
          return ok('skipped')
        }
      }
      const forceText = state.round === agent.maxToolRounds - 1
      const roundSpecs = [...specs, ...(procedureTurn?.tools() ?? [])]
      const response = await call.provider.chat({
        model: call.model.model,
        system: system + (procedureTurn?.section() ?? ''),
        messages: state.messages,
        ...(roundSpecs.length > 0 && {
          tools: roundSpecs,
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
      await recordGuard()
      await step({
        runId: run.id,
        kind: 'MODEL',
        status: 'OK',
        output: {
          round: state.round,
          modelKey: call.model.key,
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

  await procedureTurn?.close('A execução terminou antes do fim do procedimento')
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
