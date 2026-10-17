import type { AiActionLog } from '@prisma/client'
import type { AiActionLogDTO } from '@/types/steel-ai'

export function toAiActionLogDTO(row: AiActionLog): AiActionLogDTO {
  return {
    id: row.id,
    source: row.source,
    actorId: row.actorId,
    agentId: row.agentId,
    pendingActionId: row.pendingActionId,
    toolName: row.toolName,
    kind: row.kind,
    module: row.module,
    targetType: row.targetType,
    targetId: row.targetId,
    // Rows written before the outcome fix were backfilled by the migration;
    // anything else unexpected is classified by the presence of an error.
    outcome:
      row.outcome === 'success' ||
      row.outcome === 'failure' ||
      row.outcome === 'simulated'
        ? row.outcome
        : row.error
          ? 'failure'
          : 'success',
    summary: row.summary,
    error: row.error,
    oauthClientId: row.oauthClientId,
    createdAt: row.createdAt.toISOString(),
  }
}
