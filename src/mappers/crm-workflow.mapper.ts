import type {
  CrmWorkflow,
  CrmWorkflowRun,
  CrmWorkflowRunStep,
  CrmWorkflowVersion,
} from '@prisma/client'
import {
  type CrmWorkflowDefinition,
  CrmWorkflowDefinitionSchema,
  type CrmWorkflowDTO,
  type CrmWorkflowRunDTO,
  type CrmWorkflowRunStepDTO,
  type CrmWorkflowVersionDTO,
} from '@/src/schemas/crm-workflow.schema'

/**
 * Coerce do JSON cru pra `CrmWorkflowDefinition`. Validamos com Zod — se o
 * JSON estiver corrompido, fallback pra trigger vazio (não quebra a UI).
 */
export function parseCrmWorkflowDefinition(
  input: unknown,
): CrmWorkflowDefinition {
  const parsed = CrmWorkflowDefinitionSchema.safeParse(input)
  if (parsed.success) return parsed.data
  return {
    trigger: { id: 'trigger', position: { x: 0, y: 0 }, data: null },
    nodes: [],
    edges: [],
  }
}

export function toCrmWorkflowDTO(wf: CrmWorkflow): CrmWorkflowDTO {
  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    status: wf.status,
    workspaceId: wf.workspaceId,
    createdById: wf.createdById,
    updatedById: wf.updatedById,
    activeVersionId: wf.activeVersionId,
    lastRunAt: wf.lastRunAt === null ? null : wf.lastRunAt.toISOString(),
    createdAt: wf.createdAt.toISOString(),
    updatedAt: wf.updatedAt.toISOString(),
    deletedAt: wf.deletedAt === null ? null : wf.deletedAt.toISOString(),
  }
}

export function toCrmWorkflowVersionDTO(
  v: CrmWorkflowVersion,
): CrmWorkflowVersionDTO {
  return {
    id: v.id,
    workflowId: v.workflowId,
    status: v.status,
    version: v.version,
    definition: parseCrmWorkflowDefinition(v.definition),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}

export function toCrmWorkflowRunStepDTO(
  s: CrmWorkflowRunStep,
): CrmWorkflowRunStepDTO {
  return {
    id: s.id,
    runId: s.runId,
    nodeId: s.nodeId,
    nodeType: s.nodeType,
    status: s.status,
    input: s.input ?? null,
    output: s.output ?? null,
    error: s.error,
    startedAt: s.startedAt === null ? null : s.startedAt.toISOString(),
    finishedAt: s.finishedAt === null ? null : s.finishedAt.toISOString(),
  }
}

export function toCrmWorkflowRunDTO(
  run: CrmWorkflowRun & { steps?: CrmWorkflowRunStep[] },
): CrmWorkflowRunDTO {
  return {
    id: run.id,
    workflowId: run.workflowId,
    versionId: run.versionId,
    status: run.status,
    triggerType: triggerTypeToDto(run.triggerType),
    triggerPayload: run.triggerPayload ?? null,
    waitingStepId: run.waitingStepId,
    startedById: run.startedById,
    error: run.error,
    startedAt: run.startedAt === null ? null : run.startedAt.toISOString(),
    finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
    createdAt: run.createdAt.toISOString(),
    steps: run.steps?.map(toCrmWorkflowRunStepDTO),
  }
}

/** Enum Prisma (UPPER_SNAKE) → string da DTO (kebab-case). */
export function triggerTypeToDto(
  type: CrmWorkflowRun['triggerType'],
): CrmWorkflowRunDTO['triggerType'] {
  switch (type) {
    case 'RECORD_IS_CREATED':
      return 'record-is-created'
    case 'RECORD_IS_UPDATED':
      return 'record-is-updated'
    case 'RECORD_IS_DELETED':
      return 'record-is-deleted'
    case 'RECORD_IS_CREATED_OR_UPDATED':
      return 'record-is-created-or-updated'
    case 'LAUNCH_MANUALLY':
      return 'launch-manually'
    case 'ON_A_SCHEDULE':
      return 'on-a-schedule'
    case 'WEBHOOK':
      return 'webhook'
    case 'NEWSLETTER_SUBSCRIBED':
      return 'newsletter-subscribed'
    case 'NEWSLETTER_UNSUBSCRIBED':
      return 'newsletter-unsubscribed'
    case 'NEWSLETTER_LINK_CLICKED':
      return 'newsletter-link-clicked'
    case 'NEWSLETTER_ISSUE_OPENED':
      return 'newsletter-issue-opened'
  }
}

/** Reverso: DTO (kebab) → enum Prisma. */
export function triggerTypeToPrisma(
  type: CrmWorkflowRunDTO['triggerType'],
): CrmWorkflowRun['triggerType'] {
  switch (type) {
    case 'record-is-created':
      return 'RECORD_IS_CREATED'
    case 'record-is-updated':
      return 'RECORD_IS_UPDATED'
    case 'record-is-deleted':
      return 'RECORD_IS_DELETED'
    case 'record-is-created-or-updated':
      return 'RECORD_IS_CREATED_OR_UPDATED'
    case 'launch-manually':
      return 'LAUNCH_MANUALLY'
    case 'on-a-schedule':
      return 'ON_A_SCHEDULE'
    case 'webhook':
      return 'WEBHOOK'
    case 'newsletter-subscribed':
      return 'NEWSLETTER_SUBSCRIBED'
    case 'newsletter-unsubscribed':
      return 'NEWSLETTER_UNSUBSCRIBED'
    case 'newsletter-link-clicked':
      return 'NEWSLETTER_LINK_CLICKED'
    case 'newsletter-issue-opened':
      return 'NEWSLETTER_ISSUE_OPENED'
  }
}
