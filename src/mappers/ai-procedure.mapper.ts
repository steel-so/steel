import type {
  AiProcedure,
  AiProcedureRun,
  AiProcedureRunStep,
  AiProcedureVersion,
} from '@prisma/client'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type {
  AiProcedureDTO,
  AiProcedureRunDetailDTO,
  AiProcedureRunDTO,
  AiProcedureRunStepDTO,
  AiProcedureVersionDTO,
} from '@/types/ai-procedure'

export function stepsOf(value: unknown): ProcedureStep[] {
  return Array.isArray(value) ? (value as ProcedureStep[]) : []
}

export function toAiProcedureDTO(
  procedure: AiProcedure,
  runsThisMonth = 0,
): AiProcedureDTO {
  return {
    id: procedure.id,
    name: procedure.name,
    description: procedure.description,
    whenToUse: procedure.whenToUse,
    status: procedure.status,
    steps: stepsOf(procedure.steps),
    maxAttempts: procedure.maxAttempts,
    handoffMessage: procedure.handoffMessage,
    whatsappEnabled: procedure.whatsappEnabled,
    agentIds: procedure.agentIds,
    ownerId: procedure.ownerId,
    currentVersion: procedure.currentVersion,
    runsThisMonth,
    createdAt: procedure.createdAt.toISOString(),
    updatedAt: procedure.updatedAt.toISOString(),
  }
}

export function toAiProcedureVersionDTO(
  version: AiProcedureVersion,
  currentVersion: number,
): AiProcedureVersionDTO {
  return {
    id: version.id,
    number: version.number,
    whenToUse: version.whenToUse,
    steps: stepsOf(version.steps),
    maxAttempts: version.maxAttempts,
    handoffMessage: version.handoffMessage,
    changeNote: version.changeNote,
    createdById: version.createdById,
    createdAt: version.createdAt.toISOString(),
    current: version.number === currentVersion,
  }
}

export function toAiProcedureRunDTO(
  run: AiProcedureRun & { procedure: { name: string } },
): AiProcedureRunDTO {
  return {
    id: run.id,
    procedureId: run.procedureId,
    procedureName: run.procedure.name,
    versionNumber: run.versionNumber,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    status: run.status,
    failureReason: run.failureReason,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

export function toAiProcedureRunStepDTO(
  step: AiProcedureRunStep,
): AiProcedureRunStepDTO {
  return {
    id: step.id,
    position: step.position,
    stepKey: step.stepKey,
    kind: step.kind,
    title: step.title,
    status: step.status,
    input: step.input,
    output: step.output,
    error: step.error,
    createdAt: step.createdAt.toISOString(),
  }
}

export function toAiProcedureRunDetailDTO(
  run: AiProcedureRun & {
    procedure: { name: string }
    steps: AiProcedureRunStep[]
  },
): AiProcedureRunDetailDTO {
  return {
    ...toAiProcedureRunDTO(run),
    steps: run.steps.map(toAiProcedureRunStepDTO),
  }
}
