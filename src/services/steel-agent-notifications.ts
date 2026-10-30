import { emitNotification, workspaceAdminIds } from './notification-emitter'
import { emitWebhookEvent } from './webhook-emitter'
import { notifyWorkspaceSlack } from './workspace-slack-notifier'

/**
 * Inbox notices of Steel Agents. Fire-and-forget like every emitter: they
 * never fail the run.
 */

export function steelAgentRunPath(agentId: string, runId: string): string {
  return `/ai/agents/${agentId}/runs/${runId}`
}

/** Owner + workspace admins: someone must approve or reject the write(s). */
export async function notifyAgentApprovalRequested(input: {
  workspaceId: string
  agentId: string
  agentName: string
  ownerId: string | null
  runId: string
  /** Round of the run, part of the dedupe key (one notice per pause). */
  round: number
  count: number
}): Promise<number> {
  // Slack rule of the workspace (Ajustes > Integrações), fire-and-forget.
  void notifyWorkspaceSlack({
    workspaceId: input.workspaceId,
    event: 'agents.approval.pending',
    title: `${input.agentName} aguarda aprovação`,
    body:
      input.count === 1
        ? 'O agente propôs uma ação que precisa de aprovação.'
        : `O agente propôs ${input.count} ações que precisam de aprovação.`,
    path: steelAgentRunPath(input.agentId, input.runId),
  })
  // Outbound webhooks (ADR 0036), fire-and-forget.
  void emitWebhookEvent(input.workspaceId, 'agents.approval.pending', {
    agent: { id: input.agentId, name: input.agentName },
    runId: input.runId,
    count: input.count,
  })
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [
      input.ownerId,
      ...(await workspaceAdminIds(input.workspaceId)),
    ],
    kind: 'AGENT_APPROVAL_REQUESTED',
    title: `${input.agentName} aguarda aprovação`,
    body:
      input.count === 1
        ? 'O agente propôs uma ação que precisa da sua aprovação.'
        : `O agente propôs ${input.count} ações que precisam da sua aprovação.`,
    path: steelAgentRunPath(input.agentId, input.runId),
    dedupeKey: `agent-approval:${input.runId}:${input.round}`,
  })
}

export function notifyAgentRunFailed(input: {
  workspaceId: string
  agentId: string
  agentName: string
  ownerId: string | null
  createdById: string | null
  runId: string
  error: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.ownerId, input.createdById],
    kind: 'AGENT_RUN_FAILED',
    title: `Falha na execução de ${input.agentName}`,
    body: input.error.slice(0, 280),
    path: steelAgentRunPath(input.agentId, input.runId),
    dedupeKey: `agent-run-failed:${input.runId}`,
  })
}

/** Versions tab of the agent: where the gate outcome is explained. */
export function steelAgentVersionsPath(agentId: string): string {
  return `/ai/agents/${agentId}?tab=versions`
}

export function steelAgentSimulationPath(
  agentId: string,
  simulationId: string,
): string {
  return `/ai/agents/${agentId}/simulations/${simulationId}`
}

export type AgentGateOutcome = 'PUBLISHED' | 'CHALLENGER' | 'REJECTED'

const GATE_TITLES: Record<
  AgentGateOutcome,
  (name: string, n: number) => string
> = {
  PUBLISHED: (name, n) => `${name}: versão ${n} publicada`,
  CHALLENGER: (name, n) => `${name}: versão ${n} em teste A/B`,
  REJECTED: (name, n) => `${name}: versão ${n} reprovada na avaliação`,
}

/**
 * The eval gate (and, when on, the simulation gate) of a version finished:
 * published, started as A/B challenger or rejected. Owner + whoever made the
 * edit; deep link to the Versions tab.
 */
export function notifyAgentVersionGateFinished(input: {
  workspaceId: string
  agentId: string
  agentName: string
  ownerId: string | null
  createdById: string | null
  versionId: string
  number: number
  outcome: AgentGateOutcome
  /** Why it was rejected, or the pass-rate summary. */
  detail: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.ownerId, input.createdById],
    kind: 'AGENT_VERSION_GATE_FINISHED',
    title: GATE_TITLES[input.outcome](input.agentName, input.number),
    body: input.detail.slice(0, 280),
    path: steelAgentVersionsPath(input.agentId),
    dedupeKey: `agent-version-gate:${input.versionId}`,
  })
}

/**
 * A persona simulation ended (completed, failed or skipped). Gate runs of a
 * version do not use it: their outcome goes out with the version notice.
 */
export function notifyAgentSimulationFinished(input: {
  workspaceId: string
  agentId: string
  agentName: string
  ownerId: string | null
  startedById: string | null
  simulationId: string
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED'
  passed: number
  failed: number
  avgScore: number | null
  error: string | null
}): Promise<number> {
  const total = input.passed + input.failed
  let title = `${input.agentName}: simulação concluída`
  let body = `${input.passed} de ${total} cenários passaram${
    input.avgScore === null ? '' : ` (nota média ${input.avgScore})`
  }.`
  if (input.status !== 'COMPLETED') {
    title =
      input.status === 'SKIPPED'
        ? `${input.agentName}: simulação não rodou`
        : `${input.agentName}: simulação falhou`
    body = input.error ?? 'Nenhum cenário foi avaliado.'
  }
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.ownerId, input.startedById],
    kind: 'AGENT_SIMULATION_FINISHED',
    title,
    body: body.slice(0, 280),
    path: steelAgentSimulationPath(input.agentId, input.simulationId),
    dedupeKey: `agent-simulation:${input.simulationId}`,
  })
}
