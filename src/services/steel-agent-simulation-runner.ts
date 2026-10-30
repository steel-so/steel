import type { Prisma } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  type AiToolAccess,
  availableTools,
  resolveToolAccess,
  runReadTool,
  simulateWriteTool,
  toToolSpecs,
} from '@/src/lib/ai/tools/registry'
import { serializeToolResult } from '@/src/lib/ai/tools/tool-result'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type { AiMessage, AiToolCall, AiUsageTokens } from '@/src/lib/ai/types'
import { ok, type Result } from '@/src/lib/result'
import { buildSteelAgentSystemPrompt } from '@/src/lib/steel-agents/prompt'
import { SIMULATION_MAX_TOOL_ROUNDS_PER_TURN } from '@/src/lib/steel-agents/simulation/limits'
import {
  isSimulationChannel,
  type SimulationChannel,
} from '@/src/lib/steel-agents/simulation/personas'
import {
  buildAgentConversationAddendum,
  buildCustomerSystemPrompt,
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  CUSTOMER_TURN_SCHEMA,
  computeVerdict,
  JUDGE_SCHEMA,
  parseCustomerTurn,
  parseJudgement,
} from '@/src/lib/steel-agents/simulation/prompts'
import { parseVersionTools } from '@/src/lib/steel-agents/versions'
import {
  SteelAgentSimulationCaseRepository,
  type SteelAgentSimulationForExecution,
  SteelAgentSimulationRepository,
} from '@/src/repositories/steel-agent-simulation.repository'
import { SteelAgentVersionRepository } from '@/src/repositories/steel-agent-version.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  SteelAgentSimulationToolEventDTO,
  SteelAgentSimulationTurnDTO,
} from '@/types/steel-agent-simulation'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { notifyAgentSimulationFinished } from './steel-agent-notifications'
import { SteelAgentVersionService } from './steel-agent-version.service'

/**
 * Executes a persona simulation (worker job `steel-agents/simulate`). Each
 * case is a whole conversation: an AI plays the customer persona, the agent
 * answers with its real instructions and tools — reads run for real, every
 * write is simulated from its preview (never executed, no approval, nothing
 * sent) — and an AI judge scores the transcript against the criteria.
 * Cases run one after another, each with its own quota check; a failing case
 * never stops the others. Never throws.
 *
 * A simulation linked to an agent version (`agentVersionId`, the A3 gate of A2)
 * tests that version's instructions and tools instead of the published ones,
 * and reports back to the version gate. Any other simulation notifies the
 * agent's owner when it ends.
 */

const NO_REPLY = '(o agente não respondeu)'
const PROVIDER_ERROR = 'Falha ao falar com o provedor de IA'
const JUDGE_ERROR = 'O avaliador não devolveu um resultado válido'

export type SteelAgentSimulationOutcome =
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'noop'

type Case = SteelAgentSimulationForExecution['cases'][number]

interface CaseOutcome {
  status: 'DONE' | 'FAILED'
  verdict: 'PASS' | 'FAIL' | null
  score: number | null
  costUsd: number
}

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

function addUsage(total: AiUsageTokens, extra: AiUsageTokens) {
  total.inputTokens += extra.inputTokens
  total.outputTokens += extra.outputTokens
  total.cachedInputTokens =
    (total.cachedInputTokens ?? 0) + (extra.cachedInputTokens ?? 0)
}

/** Why the simulation cannot start, or null when it can. */
async function preflight(
  simulation: SteelAgentSimulationForExecution,
): Promise<{ skip: string } | { access: AiToolAccess }> {
  const { agent } = simulation
  if (!agent.ownerId) return { skip: 'O agente está sem responsável.' }

  const access = await resolveToolAccess(agent.ownerId, simulation.workspaceId)
  if (!access.ok) {
    if (access.error.code === 'FORBIDDEN') {
      return {
        skip: 'O responsável pelo agente não é mais membro do workspace.',
      }
    }
    if (access.error.code === 'WORKSPACE_SUSPENDED') {
      return { skip: 'O workspace está suspenso.' }
    }
    return { skip: access.error.message }
  }
  if (!access.value.aiEnabled) {
    return { skip: 'O Steel AI está desligado no workspace.' }
  }
  if (!access.value.agentsEnabled) {
    return { skip: 'Os Steel Agents estão desligados no workspace.' }
  }
  return { access: access.value }
}

async function prepareCall(
  workspaceId: string,
): Promise<{ call: PreparedAiCall } | { reason: string }> {
  const call = await AiUsageService.prepare(workspaceId, 'STEEL_AGENT', null)
  if (call.ok) return { call: call.value }
  if (call.error.code === 'AI_QUOTA_EXCEEDED') {
    return { reason: 'A cota mensal de IA do workspace acabou.' }
  }
  if (call.error.code === 'AI_PROVIDER_UNAVAILABLE') {
    return { reason: 'Nenhum modelo de IA disponível no workspace.' }
  }
  return { reason: call.error.message }
}

async function systemPrompt(
  simulation: SteelAgentSimulationForExecution,
  modules: Parameters<typeof buildSteelAgentSystemPrompt>[0]['modules'],
  channel: SimulationChannel,
): Promise<string> {
  const [workspace, owner] = await Promise.all([
    WorkspaceRepository.findById(simulation.workspaceId),
    UserRepository.findById(simulation.agent.ownerId as string),
  ])
  return (
    buildSteelAgentSystemPrompt({
      agentName: simulation.agent.name,
      instructions: simulation.agent.instructions,
      workspaceName: workspace.ok ? workspace.value.name : 'Workspace',
      ownerName: owner.ok ? owner.value.name : 'Responsável',
      now: new Date(),
      timezone: simulation.agent.timezone,
      modules,
    }) + buildAgentConversationAddendum({ channel })
  )
}

/** One whole conversation plus the judgement; persists the case. */
async function runCase(input: {
  simulation: SteelAgentSimulationForExecution
  item: Case
  call: PreparedAiCall
  tools: AnySteelAiTool[]
  modules: Parameters<typeof buildSteelAgentSystemPrompt>[0]['modules']
  usage: AiUsageTokens
}): Promise<CaseOutcome> {
  const { simulation, item, call, tools, modules, usage } = input
  const { agent } = simulation
  const channel: SimulationChannel = isSimulationChannel(item.channel)
    ? item.channel
    : 'WHATSAPP'
  const criteria = (
    Array.isArray(item.criteria) ? item.criteria : []
  ) as string[]

  await SteelAgentSimulationCaseRepository.update(item.id, {
    status: 'RUNNING',
    startedAt: new Date(),
  })

  const transcript: SteelAgentSimulationTurnDTO[] = []
  const toolEvents: SteelAgentSimulationToolEventDTO[] = []
  let endReason: string | null = null
  const caseUsage: AiUsageTokens = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  }

  const specs = toToolSpecs(tools)
  const ctx: AiToolContext = {
    workspaceId: simulation.workspaceId,
    actorId: agent.ownerId as string,
    source: 'agent',
    agentId: agent.id,
  }

  const handleCall = async (
    toolCall: AiToolCall,
    turn: number,
    forceText: boolean,
  ): Promise<string> => {
    const event = (
      data: Pick<SteelAgentSimulationToolEventDTO, 'status'> &
        Partial<SteelAgentSimulationToolEventDTO>,
    ) =>
      toolEvents.push({
        turn,
        toolName: toolCall.name,
        kind: 'READ',
        title: null,
        error: null,
        ...data,
      })
    if (forceText) {
      event({ status: 'FAILED', error: 'Limite de etapas por mensagem' })
      return serializeToolResult({
        status: 'error',
        error: {
          code: 'ROUND_LIMIT',
          message:
            'Limite de etapas desta mensagem atingido; responda ao cliente com o que já sabe.',
        },
      })
    }
    const tool = tools.find((candidate) => candidate.name === toolCall.name)
    if (!tool) {
      event({ status: 'FAILED', error: 'Ferramenta não permitida' })
      return serializeToolResult({
        status: 'error',
        error: {
          code: 'AI_TOOL_NOT_ALLOWED',
          message: 'Ferramenta não permitida para este agente',
        },
      })
    }
    if (tool.kind === 'READ') {
      const result = await runReadTool(tool, ctx, toolCall.arguments)
      event({
        kind: tool.kind,
        status: result.ok ? 'OK' : 'FAILED',
        ...(result.ok
          ? { title: result.output.summary }
          : { error: result.error.message }),
      })
      return result.content
    }
    const simulated = await simulateWriteTool(tool, ctx, toolCall.arguments, {
      actorId: simulation.startedById,
    })
    event({
      kind: tool.kind,
      status: simulated.ok ? 'SIMULATED' : 'FAILED',
      ...(simulated.ok
        ? { title: simulated.simulation.preview.title }
        : { error: simulated.error.message }),
    })
    return simulated.content
  }

  /** The agent answers one customer message (tool loop included). */
  const agentReply = async (
    system: string,
    messages: AiMessage[],
    turn: number,
  ): Promise<string> => {
    let text = ''
    for (let round = 0; round < SIMULATION_MAX_TOOL_ROUNDS_PER_TURN; round++) {
      const forceText = round === SIMULATION_MAX_TOOL_ROUNDS_PER_TURN - 1
      const response = await call.provider.chat({
        model: call.model.model,
        system,
        messages,
        ...(specs.length > 0 && {
          tools: specs,
          toolChoice: forceText ? ('none' as const) : ('auto' as const),
        }),
      })
      addUsage(caseUsage, response.usage)
      messages.push(response.message)
      text = response.text
      if (response.toolCalls.length === 0) break
      for (const toolCall of response.toolCalls) {
        const content = await handleCall(toolCall, turn, forceText)
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          name: toolCall.name,
          content,
        })
      }
      if (forceText) break
    }
    return text.trim() || NO_REPLY
  }

  let outcome: CaseOutcome
  try {
    const agentSystem = await systemPrompt(simulation, modules, channel)
    const customerSystem = buildCustomerSystemPrompt({
      persona: item.persona,
      scenario: item.scenario,
      channel,
      maxTurns: item.maxTurns,
    })
    const agentMessages: AiMessage[] = []
    // The persona sees the agent's lines as "user" and its own as "assistant".
    const customerMessages: AiMessage[] = [
      {
        role: 'user',
        content: 'A conversa vai começar. Escreva a sua primeira mensagem.',
      },
      { role: 'assistant', content: item.openingMessage },
    ]

    for (let turn = 1; turn <= item.maxTurns; turn++) {
      let customerText = item.openingMessage
      if (turn > 1) {
        const response = await call.provider.chat({
          model: call.model.model,
          system: customerSystem,
          messages: customerMessages,
          jsonSchema: CUSTOMER_TURN_SCHEMA,
          maxTokens: 500,
        })
        addUsage(caseUsage, response.usage)
        const next = parseCustomerTurn(response.text)
        if (next.end || !next.message) {
          endReason = next.end
            ? next.reason || 'O cliente encerrou a conversa'
            : 'O cliente não respondeu'
          if (next.end && next.message) {
            transcript.push({ role: 'customer', text: next.message })
          }
          break
        }
        customerText = next.message
        customerMessages.push({
          role: 'assistant',
          content: customerText,
        })
      }
      transcript.push({ role: 'customer', text: customerText })
      agentMessages.push({ role: 'user', content: customerText })

      const reply = await agentReply(agentSystem, agentMessages, turn)
      transcript.push({ role: 'agent', text: reply })
      customerMessages.push({ role: 'user', content: reply })
    }
    endReason ??= 'Limite de mensagens atingido'

    const judged = await call.provider.chat({
      model: call.model.model,
      system: buildJudgeSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildJudgeUserMessage({
            agentName: agent.name,
            agentInstructions: agent.instructions,
            persona: item.persona,
            scenario: item.scenario,
            channel,
            criteria,
            transcript,
            toolEvents,
            endReason,
          }),
        },
      ],
      jsonSchema: JUDGE_SCHEMA,
      maxTokens: 1_500,
    })
    addUsage(caseUsage, judged.usage)
    const judgement = parseJudgement(judged.text, criteria)

    if (!judgement) {
      outcome = { status: 'FAILED', verdict: null, score: null, costUsd: 0 }
      await SteelAgentSimulationCaseRepository.update(item.id, {
        status: 'FAILED',
        error: JUDGE_ERROR,
        endReason,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        toolEvents: toolEvents as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      })
    } else {
      const verdict = computeVerdict(judgement, simulation.passScore)
      outcome = {
        status: 'DONE',
        verdict,
        score: judgement.score,
        costUsd: 0,
      }
      await SteelAgentSimulationCaseRepository.update(item.id, {
        status: 'DONE',
        verdict,
        score: judgement.score,
        judgeSummary: judgement.summary,
        criteriaResults: judgement.criteria as unknown as Prisma.InputJsonValue,
        endReason,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        toolEvents: toolEvents as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      })
    }
  } catch (cause) {
    const message = errorMessage(cause)
    logger.error(
      'steel_agents.simulation_case_failed',
      logFields(
        {
          component: 'SteelAgentSimulationRunner',
          workspaceId: simulation.workspaceId,
          message,
        },
        { simulationId: simulation.id, caseId: item.id },
      ),
    )
    outcome = { status: 'FAILED', verdict: null, score: null, costUsd: 0 }
    await SteelAgentSimulationCaseRepository.update(item.id, {
      status: 'FAILED',
      error: `${PROVIDER_ERROR}: ${message}`.slice(0, 2_000),
      endReason,
      transcript: transcript as unknown as Prisma.InputJsonValue,
      toolEvents: toolEvents as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    })
  }

  const costUsd = AiUsageService.price(call, caseUsage)
  await SteelAgentSimulationCaseRepository.update(item.id, {
    inputTokens: caseUsage.inputTokens,
    outputTokens: caseUsage.outputTokens,
    costUsd,
  })
  await AiUsageService.record(call, {
    workspaceId: simulation.workspaceId,
    userId: null,
    usage: caseUsage,
  })
  addUsage(usage, caseUsage)
  return { ...outcome, costUsd }
}

/**
 * Tells whoever is waiting that the simulation ended: the version gate for a
 * gate run (it notifies the owner itself), the agent's owner otherwise.
 */
async function reportFinished(
  simulation: SteelAgentSimulationForExecution,
  result: {
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED'
    passed: number
    failed: number
    avgScore: number | null
    error: string | null
  },
): Promise<void> {
  if (simulation.agentVersionId) {
    await SteelAgentVersionService.onSimulationFinished({
      versionId: simulation.agentVersionId,
      simulationId: simulation.id,
      status: result.status,
      passed: result.passed,
      failed: result.failed,
      error: result.error,
    })
    return
  }
  await notifyAgentSimulationFinished({
    workspaceId: simulation.workspaceId,
    agentId: simulation.agentId,
    agentName: simulation.agent.name,
    ownerId: simulation.agent.ownerId,
    startedById: simulation.startedById,
    simulationId: simulation.id,
    ...result,
  })
}

/** Gate runs test the version's content, not the agent's published one. */
async function overlayVersion(
  simulation: SteelAgentSimulationForExecution,
): Promise<Result<SteelAgentSimulationForExecution | null>> {
  if (!simulation.agentVersionId) return ok(simulation)
  const version = await SteelAgentVersionRepository.findByIdUnscoped(
    simulation.agentVersionId,
  )
  if (!version.ok) return version
  const found = version.value
  if (!found) return ok(null)
  const { agent } = simulation
  return ok({
    ...simulation,
    agent: {
      ...agent,
      instructions: found.instructions,
      maxToolRounds: found.maxToolRounds,
      tools: parseVersionTools(found.tools).map((tool) => ({
        id: `${found.id}:${tool.toolName}`,
        agentId: agent.id,
        toolName: tool.toolName,
        mode: tool.mode,
        createdAt: found.createdAt,
      })),
    },
  })
}

export async function executeSteelAgentSimulation(
  simulationId: string,
): Promise<Result<SteelAgentSimulationOutcome>> {
  const loaded =
    await SteelAgentSimulationRepository.findForExecution(simulationId)
  if (!loaded.ok) return loaded
  const stored = loaded.value
  if (stored.status !== 'QUEUED') return ok('noop')
  const overlaid = await overlayVersion(stored)
  if (!overlaid.ok) return overlaid
  const versionMissing = overlaid.value === null
  const simulation = overlaid.value ?? stored

  const skip = async (reason: string) => {
    const claimed = await SteelAgentSimulationRepository.claim(
      simulation.id,
      ['QUEUED'],
      { status: 'SKIPPED', error: reason, finishedAt: new Date() },
    )
    if (claimed.ok && claimed.value) {
      await SteelAgentSimulationCaseRepository.failUnfinished(
        simulation.id,
        reason,
      )
    }
    logger.warn(
      'steel_agents.simulation_skipped',
      logFields(
        {
          component: 'SteelAgentSimulationRunner',
          workspaceId: simulation.workspaceId,
        },
        { simulationId: simulation.id, reason },
      ),
    )
    if (claimed.ok && claimed.value) {
      await reportFinished(simulation, {
        status: 'SKIPPED',
        passed: 0,
        failed: 0,
        avgScore: null,
        error: reason,
      })
    }
    return ok<SteelAgentSimulationOutcome>('skipped')
  }

  if (versionMissing) return skip('A versão avaliada não existe mais.')
  const checked = await preflight(simulation)
  if ('skip' in checked) return skip(checked.skip)
  const { access } = checked

  const claimed = await SteelAgentSimulationRepository.claim(
    simulation.id,
    ['QUEUED'],
    { status: 'RUNNING', startedAt: new Date() },
  )
  if (!claimed.ok) return claimed
  if (!claimed.value) return ok('noop')

  const allowed = new Set(simulation.agent.tools.map((t) => t.toolName))
  const tools = availableTools(access, 'TEST').filter((tool) =>
    allowed.has(tool.name),
  )

  const usage: AiUsageTokens = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  }
  const scores: number[] = []
  let passed = 0
  let failed = 0
  let judged = 0
  let costUsd = 0
  let modelKey: string | null = null
  let stopReason: string | null = null

  for (const item of simulation.cases) {
    if (stopReason) {
      failed++
      await SteelAgentSimulationCaseRepository.update(item.id, {
        status: 'FAILED',
        error: stopReason,
        finishedAt: new Date(),
      })
      continue
    }
    const prepared = await prepareCall(simulation.workspaceId)
    if ('reason' in prepared) {
      stopReason = prepared.reason
      failed++
      await SteelAgentSimulationCaseRepository.update(item.id, {
        status: 'FAILED',
        error: stopReason,
        finishedAt: new Date(),
      })
      continue
    }
    const { call } = prepared
    modelKey = call.model.key
    const outcome = await runCase({
      simulation,
      item,
      call,
      tools,
      modules: access.modules,
      usage,
    })
    costUsd += outcome.costUsd
    if (outcome.status === 'DONE') {
      judged++
      scores.push(outcome.score as number)
      if (outcome.verdict === 'PASS') passed++
      else failed++
    } else {
      failed++
    }
    // Progress is visible while the next cases still run.
    await SteelAgentSimulationRepository.update(simulation.id, {
      passedCases: passed,
      failedCases: failed,
      modelKey,
    })
  }

  const avgScore =
    scores.length > 0
      ? Math.round(
          scores.reduce((sum, score) => sum + score, 0) / scores.length,
        )
      : null
  const status = judged > 0 ? 'COMPLETED' : 'FAILED'
  await SteelAgentSimulationRepository.update(simulation.id, {
    status,
    passedCases: passed,
    failedCases: failed,
    avgScore,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    modelKey,
    finishedAt: new Date(),
    ...(stopReason && { error: stopReason }),
    ...(status === 'FAILED' &&
      !stopReason && { error: 'Nenhum cenário foi avaliado.' }),
  })
  logger.info(
    'steel_agents.simulation_finished',
    logFields(
      {
        component: 'SteelAgentSimulationRunner',
        workspaceId: simulation.workspaceId,
      },
      {
        simulationId: simulation.id,
        agentId: simulation.agentId,
        status,
        passed,
        failed,
        avgScore,
      },
    ),
  )
  await reportFinished(simulation, {
    status,
    passed,
    failed,
    avgScore,
    error:
      stopReason ??
      (status === 'FAILED' ? 'Nenhum cenário foi avaliado.' : null),
  })
  return ok(status === 'COMPLETED' ? 'completed' : 'failed')
}
