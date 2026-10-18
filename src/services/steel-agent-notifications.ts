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
