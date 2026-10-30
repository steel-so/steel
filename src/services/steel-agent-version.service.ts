import type { SteelAgentVersion } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  aiDisabled,
  appError,
  steelAgentEvalSetInvalid,
  steelAgentSimGateInvalid,
  steelAgentVersionInvalidState,
  steelAgentVersionNotFound,
  steelAgentVersionPending,
} from '@/src/errors/app-error'
import { findTool } from '@/src/lib/ai/tools/registry'
import { can } from '@/src/lib/permissions'
import { AiEvalJob } from '@/src/lib/queue/jobs'
import { getAiEvalQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { enqueueSteelAgentSimulation } from '@/src/lib/steel-agents/enqueue'
import {
  evaluateGate,
  normalizeVersionTools,
  parseVersionTools,
  summarizeVersionStats,
  type VersionContent,
} from '@/src/lib/steel-agents/versions'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import {
  toSteelAgentVersionDTO,
  toSteelAgentVersionRefDTO,
} from '@/src/mappers/steel-agent.mapper'
import { AiEvalRepository } from '@/src/repositories/ai-eval.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import {
  SteelAgentRepository,
  type SteelAgentWithRelations,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentSimulationRepository } from '@/src/repositories/steel-agent-simulation.repository'
import { SteelAgentVersionRepository } from '@/src/repositories/steel-agent-version.repository'
import type { RestoreSteelAgentVersionDTO } from '@/src/schemas/steel-agent.schema'
import type {
  SteelAgentVersionListDTO,
  SteelAgentVersionRefDTO,
} from '@/types/steel-agent'
import { assertMember, type MembershipContext } from './authz'
import { notifyAgentVersionGateFinished } from './steel-agent-notifications'

/**
 * Steel Agent versions (A2). Every edit of the instructions, the tools or the
 * tool-round cap becomes a numbered version. With a gate eval set configured
 * the version waits for the eval run and is published (or goes live as an
 * A/B challenger) only when enough cases pass; without one it is published at
 * once. The agent's own columns always mirror the published version.
 *
 * A3 adds a second, optional gate: when the agent has `simGateEnabled`, the
 * saved simulation scenarios are replayed against the version (after the eval
 * passed, or alone when there is no eval set) and the version only goes live
 * if both meet their minimum. The outcome notifies the agent's owner.
 */

const RESOURCE = 'steel-agents'
const COMPONENT = 'SteelAgentVersionService'

const kindOf = (name: string) => findTool(name)?.kind

function canManage(membership: MembershipContext): boolean {
  return (
    membership.isPrivileged ||
    (membership.permissions !== null &&
      can(membership.permissions, RESOURCE, 'EDIT'))
  )
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`

function contentOf(agent: SteelAgentWithRelations): VersionContent {
  return {
    instructions: agent.instructions,
    maxToolRounds: agent.maxToolRounds,
    tools: normalizeVersionTools(
      agent.tools.map((tool) => ({ toolName: tool.toolName, mode: tool.mode })),
    ),
  }
}

/** The eval set that gates versions must exist and be a STEEL_AGENT set. */
async function checkEvalSet(
  workspaceId: string,
  setId: string,
  options: { requireCases: boolean },
): Promise<Result<{ caseCount: number }>> {
  const set = await AiEvalRepository.findSet(setId, workspaceId)
  if (!set.ok) return set
  if (!set.value) {
    return err(
      steelAgentEvalSetInvalid(
        'O conjunto de avaliação deste agente não existe mais. Escolha outro em Avaliação das versões.',
      ),
    )
  }
  if (set.value.target !== 'STEEL_AGENT') {
    return err(
      steelAgentEvalSetInvalid(
        'O conjunto precisa ser do tipo "Steel Agents (trava de versão)".',
      ),
    )
  }
  if (options.requireCases && set.value.caseCount === 0) {
    return err(
      steelAgentEvalSetInvalid(
        'O conjunto de avaliação não tem casos de teste. Adicione casos ou remova a trava.',
      ),
    )
  }
  return ok({ caseCount: set.value.caseCount })
}

/** Legacy agents get their current state recorded as v1 on first edit. */
async function ensureBaseline(
  agent: SteelAgentWithRelations,
  actorId: string | null,
): Promise<Result<true>> {
  if (agent.publishedVersionId) return ok(true)
  const content = contentOf(agent)
  const created = await SteelAgentVersionRepository.create({
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    status: 'PUBLISHED',
    ...content,
    changeNote: 'Versão inicial',
    createdById: actorId,
  })
  if (!created.ok) return created
  return SteelAgentVersionRepository.setPublishedPointer(
    agent.id,
    created.value.id,
  )
}

/** Publishes the version, or starts it as A/B challenger when it asks to. */
async function goLive(
  version: SteelAgentVersion,
): Promise<Result<SteelAgentVersion>> {
  if (version.rolloutPercent) {
    return SteelAgentVersionRepository.makeChallenger(
      version.id,
      version.agentId,
      version.rolloutPercent,
    )
  }
  return SteelAgentVersionRepository.publish(
    version,
    parseVersionTools(version.tools),
  )
}

/** Creates the gate eval run for `version` and queues it. */
async function startGateEval(
  actorId: string,
  version: SteelAgentVersion,
  setId: string,
  caseCount: number,
): Promise<Result<SteelAgentVersion>> {
  const settingsRow = await WorkspaceAiSettingsRepository.findByWorkspace(
    version.workspaceId,
  )
  if (!settingsRow.ok) return settingsRow
  if (!toEffectiveAiSettings(settingsRow.value).aiEnabled) {
    return err(aiDisabled())
  }
  const active = await AiEvalRepository.findActiveRun(setId)
  if (!active.ok) return active
  if (active.value) {
    return err(
      steelAgentEvalSetInvalid(
        'O conjunto de avaliação está em uso por outra avaliação. Aguarde terminar.',
      ),
    )
  }
  const run = await AiEvalRepository.createRun({
    workspaceId: version.workspaceId,
    setId,
    modelKey: null,
    skillId: null,
    promptOverride: null,
    reason: 'prompt_change',
    startedById: actorId,
    caseCount,
    agentVersionId: version.id,
  })
  if (!run.ok) return run
  try {
    await getAiEvalQueue().add(
      AiEvalJob.Run,
      { runId: run.value.id },
      { jobId: `ai-eval-${run.value.id}` },
    )
  } catch (cause) {
    logger.error(
      'steel_agents.version_eval_enqueue_failed',
      logFields(
        {
          component: COMPONENT,
          workspaceId: version.workspaceId,
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { versionId: version.id, runId: run.value.id },
      ),
    )
    await AiEvalRepository.finishRun(run.value.id, {
      status: 'FAILED',
      modelKey: null,
      judgeModelKey: null,
      caseCount,
      passedCount: 0,
      failedCount: 0,
      avgScore: null,
      costUsd: 0,
      error: 'Não foi possível enfileirar a avaliação.',
      finishedAt: new Date(),
    })
    return err(
      appError(
        'INTERNAL_SERVER_ERROR',
        'Não foi possível enfileirar a avaliação da versão. Tente de novo em instantes.',
      ),
    )
  }
  return SteelAgentVersionRepository.update(version.id, {
    evalRunId: run.value.id,
  })
}

/** The saved scenarios the simulation gate replays; the gate needs at least one. */
async function loadGateScenarios(agentId: string): Promise<
  Result<{
    passScore: number
    cases: Parameters<typeof SteelAgentSimulationRepository.create>[0]['cases']
  }>
> {
  const set = await SteelAgentSimulationRepository.latestScenarioSet(agentId)
  if (!set.ok) return set
  if (!set.value) {
    return err(
      steelAgentSimGateInvalid(
        'O agente não tem cenários salvos. Crie e rode uma simulação em Simulações antes de ligar a trava.',
      ),
    )
  }
  return ok(set.value)
}

/** Replays the saved scenarios against `version` and queues the run. */
async function startGateSimulation(
  actorId: string | null,
  version: SteelAgentVersion,
): Promise<Result<SteelAgentVersion>> {
  const settingsRow = await WorkspaceAiSettingsRepository.findByWorkspace(
    version.workspaceId,
  )
  if (!settingsRow.ok) return settingsRow
  if (!toEffectiveAiSettings(settingsRow.value).aiEnabled) {
    return err(aiDisabled())
  }
  const scenarios = await loadGateScenarios(version.agentId)
  if (!scenarios.ok) return scenarios
  const simulation = await SteelAgentSimulationRepository.create({
    workspaceId: version.workspaceId,
    agentId: version.agentId,
    name: `Trava da versão ${version.number}`,
    startedById: actorId,
    passScore: scenarios.value.passScore,
    cases: scenarios.value.cases,
    agentVersionId: version.id,
  })
  if (!simulation.ok) return simulation
  const queued = await enqueueSteelAgentSimulation(simulation.value.id)
  if (!queued.ok) {
    await SteelAgentSimulationRepository.update(simulation.value.id, {
      status: 'FAILED',
      error: queued.error.message,
      finishedAt: new Date(),
    })
    return queued
  }
  return SteelAgentVersionRepository.update(version.id, {
    simulationId: simulation.value.id,
  })
}

/** One line per gate that ran: "Avaliação: 8 de 10 casos · Simulação: ...". */
function gateSummary(
  version: Pick<
    SteelAgentVersion,
    'evalPassed' | 'evalTotal' | 'simPassed' | 'simTotal'
  >,
): string {
  const parts: string[] = []
  if (version.evalTotal) {
    parts.push(
      `Avaliação: ${version.evalPassed ?? 0} de ${version.evalTotal} casos`,
    )
  }
  if (version.simTotal) {
    parts.push(
      `Simulação: ${version.simPassed ?? 0} de ${version.simTotal} cenários`,
    )
  }
  return parts.join(' · ')
}

/** Audit + log + owner notice once a gate reached its final outcome. */
async function concludeGate(
  agent: SteelAgentWithRelations,
  before: SteelAgentVersion,
  outcome: SteelAgentVersion,
): Promise<void> {
  const rejected = outcome.status === 'REJECTED'
  auditMutation({
    entity: 'steel_agent_version',
    action: rejected ? 'cancel' : 'publish',
    actorId: null,
    targetId: before.id,
    meta: {
      workspaceId: before.workspaceId,
      agentId: before.agentId,
      number: before.number,
      status: outcome.status,
      passed: outcome.evalPassed,
      total: outcome.evalTotal,
      simPassed: outcome.simPassed,
      simTotal: outcome.simTotal,
    },
  })
  logger.info(
    'steel_agents.version_gate_finished',
    logFields(
      { component: COMPONENT, workspaceId: before.workspaceId },
      {
        agentId: before.agentId,
        versionId: before.id,
        status: outcome.status,
      },
    ),
  )
  await notifyAgentVersionGateFinished({
    workspaceId: before.workspaceId,
    agentId: before.agentId,
    agentName: agent.name,
    ownerId: agent.ownerId,
    createdById: before.createdById,
    versionId: before.id,
    number: before.number,
    outcome: rejected
      ? 'REJECTED'
      : outcome.status === 'CHALLENGER'
        ? 'CHALLENGER'
        : 'PUBLISHED',
    detail: rejected
      ? (outcome.evalNote ?? 'A versão não passou na avaliação.')
      : gateSummary(outcome),
  })
}

/** Rejects a pending version with the reason shown in the Versions tab. */
async function rejectVersion(
  agent: SteelAgentWithRelations,
  version: SteelAgentVersion,
  note: string,
): Promise<void> {
  const closed = await SteelAgentVersionRepository.close(
    version.id,
    version.agentId,
    'REJECTED',
    { evalNote: note },
  )
  if (closed.ok) await concludeGate(agent, version, closed.value)
}

export interface SubmitVersionInput {
  actorId: string
  agent: SteelAgentWithRelations
  /** The full versioned content the edit would leave the agent with. */
  content: VersionContent
  changeNote: string | null
  rolloutPercent: number | null
  evalSetId: string | null
  /** Effective simulation gate of this edit; defaults to the agent's setting. */
  simGateEnabled?: boolean
}

export const SteelAgentVersionService = {
  checkEvalSet,

  /** Turning the simulation gate on needs saved scenarios to replay. */
  async checkSimulationGate(agentId: string): Promise<Result<true>> {
    const scenarios = await loadGateScenarios(agentId)
    return scenarios.ok ? ok(true) : scenarios
  },

  /** Records the agent's current state as v1 when it has no version yet. */
  ensureBaseline,

  /**
   * Turns an edit into a version: waits for the gate eval when the agent has
   * one, otherwise goes live at once. The caller has already authorized the
   * actor and validated the content.
   */
  async submit(input: SubmitVersionInput): Promise<Result<SteelAgentVersion>> {
    const { actorId, agent } = input
    const pending = await SteelAgentVersionRepository.findPending(agent.id)
    if (!pending.ok) return pending
    if (pending.value) return err(steelAgentVersionPending())

    let caseCount = 0
    if (input.evalSetId) {
      const set = await checkEvalSet(agent.workspaceId, input.evalSetId, {
        requireCases: true,
      })
      if (!set.ok) return set
      caseCount = set.value.caseCount
    }

    const simGate = input.simGateEnabled ?? agent.simGateEnabled
    if (simGate) {
      const scenarios = await loadGateScenarios(agent.id)
      if (!scenarios.ok) return scenarios
    }

    const baseline = await ensureBaseline(agent, actorId)
    if (!baseline.ok) return baseline

    const created = await SteelAgentVersionRepository.create({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      status: 'PENDING_EVAL',
      ...input.content,
      changeNote: input.changeNote,
      rolloutPercent: input.rolloutPercent,
      createdById: actorId,
    })
    if (!created.ok) return created

    let result: Result<SteelAgentVersion>
    if (input.evalSetId || simGate) {
      result = input.evalSetId
        ? await startGateEval(
            actorId,
            created.value,
            input.evalSetId,
            caseCount,
          )
        : await startGateSimulation(actorId, created.value)
      if (!result.ok) {
        await SteelAgentVersionRepository.close(
          created.value.id,
          agent.id,
          'DISCARDED',
          { evalNote: result.error.message },
        )
        return result
      }
    } else {
      result = await goLive(created.value)
      if (!result.ok) return result
    }

    auditMutation({
      entity: 'steel_agent_version',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: {
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        number: result.value.number,
        status: result.value.status,
        gated: Boolean(input.evalSetId),
        simGated: simGate,
        rolloutPercent: input.rolloutPercent,
      },
    })
    return result
  },

  async list(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentVersionListDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const agent = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!agent.ok) return agent
    const [versions, rows] = await Promise.all([
      SteelAgentVersionRepository.listByAgent(agentId, workspaceId),
      SteelAgentVersionRepository.statsRows(agentId),
    ])
    if (!versions.ok) return versions
    if (!rows.ok) return rows
    const stats = summarizeVersionStats(rows.value.runs, rows.value.approvals)
    return ok({
      versions: versions.value.map((version) =>
        toSteelAgentVersionDTO(version, stats.get(version.id), kindOf),
      ),
      publishedVersionId: agent.value.publishedVersionId,
      challengerVersionId: agent.value.challengerVersionId,
      evalSetId: agent.value.evalSetId,
      evalMinPassRate: agent.value.evalMinPassRate,
      simGateEnabled: agent.value.simGateEnabled,
      simGateMinPassRate: agent.value.simGateMinPassRate,
      canManage: canManage(membership.value),
    })
  },

  /** Promotes the A/B challenger to the published version. */
  async promote(
    actorId: string,
    workspaceId: string,
    agentId: string,
    versionId: string,
  ): Promise<Result<SteelAgentVersionRefDTO>> {
    const loaded = await loadForAction(actorId, workspaceId, agentId, versionId)
    if (!loaded.ok) return loaded
    const { version } = loaded.value
    if (version.status !== 'CHALLENGER') {
      return err(
        steelAgentVersionInvalidState(
          'Só a versão em teste A/B pode ser promovida.',
        ),
      )
    }
    const published = await SteelAgentVersionRepository.publish(
      version,
      parseVersionTools(version.tools),
    )
    if (!published.ok) return published
    auditMutation({
      entity: 'steel_agent_version',
      action: 'publish',
      actorId,
      targetId: versionId,
      meta: { workspaceId, agentId, number: version.number, via: 'promote' },
    })
    return ok(toSteelAgentVersionRefDTO(published.value))
  },

  /** Stops a pending evaluation or the A/B experiment without publishing. */
  async discard(
    actorId: string,
    workspaceId: string,
    agentId: string,
    versionId: string,
  ): Promise<Result<SteelAgentVersionRefDTO>> {
    const loaded = await loadForAction(actorId, workspaceId, agentId, versionId)
    if (!loaded.ok) return loaded
    const { version } = loaded.value
    if (version.status !== 'PENDING_EVAL' && version.status !== 'CHALLENGER') {
      return err(
        steelAgentVersionInvalidState(
          'Só uma versão em avaliação ou em teste A/B pode ser descartada.',
        ),
      )
    }
    const closed = await SteelAgentVersionRepository.close(
      versionId,
      agentId,
      'DISCARDED',
    )
    if (!closed.ok) return closed
    auditMutation({
      entity: 'steel_agent_version',
      action: 'cancel',
      actorId,
      targetId: versionId,
      meta: { workspaceId, agentId, number: version.number },
    })
    return ok(toSteelAgentVersionRefDTO(closed.value))
  },

  /**
   * Brings an old version back as a NEW version: it goes through the same
   * gate (and optional A/B split) as any edit, so a rollback is never
   * unreviewed either.
   */
  async restore(
    actorId: string,
    workspaceId: string,
    agentId: string,
    versionId: string,
    dto: RestoreSteelAgentVersionDTO,
  ): Promise<Result<SteelAgentVersionRefDTO>> {
    const loaded = await loadForAction(actorId, workspaceId, agentId, versionId)
    if (!loaded.ok) return loaded
    const { version, agent } = loaded.value
    if (
      version.status === 'PUBLISHED' ||
      version.status === 'CHALLENGER' ||
      version.status === 'PENDING_EVAL'
    ) {
      return err(
        steelAgentVersionInvalidState(
          'Esta versão já está em uso ou em avaliação.',
        ),
      )
    }
    const submitted = await SteelAgentVersionService.submit({
      actorId,
      agent,
      content: {
        instructions: version.instructions,
        maxToolRounds: version.maxToolRounds,
        tools: parseVersionTools(version.tools),
      },
      changeNote: dto.changeNote ?? `Restaurada da v${version.number}`,
      rolloutPercent: dto.rolloutPercent ?? null,
      evalSetId: agent.evalSetId,
    })
    if (!submitted.ok) return submitted
    return ok(toSteelAgentVersionRefDTO(submitted.value))
  },

  /**
   * Worker side: the gate eval run ended. Rejects the version when the pass
   * rate is under the agent's minimum; otherwise it goes live, or, when the
   * agent also gates on simulations, waits for the scenarios to be replayed
   * (`onSimulationFinished`). Never throws; a version that is no longer
   * pending is left alone.
   */
  async onEvalFinished(input: {
    versionId: string
    evalRunId: string
    status: 'DONE' | 'FAILED'
    passed: number
    failed: number
    error: string | null
  }): Promise<void> {
    try {
      const loaded = await SteelAgentVersionRepository.findByIdUnscoped(
        input.versionId,
      )
      if (!loaded.ok || !loaded.value) return
      const version = loaded.value
      if (version.status !== 'PENDING_EVAL') return
      const agent = await SteelAgentRepository.findById(
        version.agentId,
        version.workspaceId,
      )
      if (!agent.ok) return

      const gate = evaluateGate({
        passedCases: input.passed,
        failedCases: input.failed,
        minPassRate: agent.value.evalMinPassRate,
      })
      const recorded = await SteelAgentVersionRepository.update(version.id, {
        evalRunId: input.evalRunId,
        evalPassed: gate.passedCases,
        evalTotal: gate.total,
      })
      if (!recorded.ok) return

      if (input.status !== 'DONE' || !gate.passed) {
        const note =
          input.status === 'FAILED'
            ? (input.error ?? 'A avaliação não terminou.')
            : gate.total === 0
              ? 'Nenhum caso foi avaliado.'
              : `Passou em ${gate.passedCases} de ${gate.total} casos (${percent(gate.rate)}); o mínimo é ${percent(agent.value.evalMinPassRate)}.`
        await rejectVersion(agent.value, recorded.value, note)
        return
      }

      if (agent.value.simGateEnabled) {
        const started = await startGateSimulation(
          version.createdById,
          recorded.value,
        )
        if (!started.ok) {
          await rejectVersion(
            agent.value,
            recorded.value,
            `A avaliação passou, mas a simulação não pôde começar: ${started.error.message}`,
          )
        }
        return
      }

      const live = await goLive(recorded.value)
      if (live.ok) await concludeGate(agent.value, version, live.value)
    } catch (cause) {
      logger.error(
        'steel_agents.version_gate_failed',
        logFields(
          {
            component: COMPONENT,
            message: cause instanceof Error ? cause.message : String(cause),
          },
          { versionId: input.versionId },
        ),
      )
    }
  },

  /**
   * Worker side: the gate simulation of a version ended. The version goes
   * live only when enough scenarios passed (the agent's simulation minimum);
   * a simulation that failed or could not run rejects it. Never throws; a
   * version that is no longer pending is left alone.
   */
  async onSimulationFinished(input: {
    versionId: string
    simulationId: string
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED'
    passed: number
    failed: number
    error: string | null
  }): Promise<void> {
    try {
      const loaded = await SteelAgentVersionRepository.findByIdUnscoped(
        input.versionId,
      )
      if (!loaded.ok || !loaded.value) return
      const version = loaded.value
      if (version.status !== 'PENDING_EVAL') return
      const agent = await SteelAgentRepository.findById(
        version.agentId,
        version.workspaceId,
      )
      if (!agent.ok) return

      const gate = evaluateGate({
        passedCases: input.passed,
        failedCases: input.failed,
        minPassRate: agent.value.simGateMinPassRate,
      })
      const recorded = await SteelAgentVersionRepository.update(version.id, {
        simulationId: input.simulationId,
        simPassed: gate.passedCases,
        simTotal: gate.total,
      })
      if (!recorded.ok) return

      if (input.status !== 'COMPLETED' || !gate.passed) {
        const note =
          input.status !== 'COMPLETED'
            ? `A simulação não terminou: ${input.error ?? 'nenhum cenário foi avaliado.'}`
            : gate.total === 0
              ? 'Nenhum cenário foi avaliado.'
              : `Passou em ${gate.passedCases} de ${gate.total} cenários da simulação (${percent(gate.rate)}); o mínimo é ${percent(agent.value.simGateMinPassRate)}.`
        await rejectVersion(agent.value, recorded.value, note)
        return
      }

      const live = await goLive(recorded.value)
      if (live.ok) await concludeGate(agent.value, version, live.value)
    } catch (cause) {
      logger.error(
        'steel_agents.version_sim_gate_failed',
        logFields(
          {
            component: COMPONENT,
            message: cause instanceof Error ? cause.message : String(cause),
          },
          { versionId: input.versionId },
        ),
      )
    }
  },
}

async function loadForAction(
  actorId: string,
  workspaceId: string,
  agentId: string,
  versionId: string,
): Promise<
  Result<{ version: SteelAgentVersion; agent: SteelAgentWithRelations }>
> {
  const membership = await assertMember(actorId, workspaceId, {
    resource: RESOURCE,
    action: 'EDIT',
  })
  if (!membership.ok) return membership
  const agent = await SteelAgentRepository.findById(agentId, workspaceId)
  if (!agent.ok) return agent
  const version = await SteelAgentVersionRepository.findById(
    versionId,
    workspaceId,
  )
  if (!version.ok) return version
  if (version.value.agentId !== agentId) {
    return err(steelAgentVersionNotFound())
  }
  return ok({ version: version.value, agent: agent.value })
}
