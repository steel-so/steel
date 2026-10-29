import type { CrmCadenceRun, CrmCadenceStep } from '@prisma/client'
import type {
  CrmCadenceEnrollmentView,
  CrmCadenceWithSteps,
} from '@/src/repositories/crm-cadence.repository'
import type {
  CrmCadenceDTO,
  CrmCadenceEnrollmentDTO,
  CrmCadenceRunDTO,
  CrmCadenceStatsDTO,
  CrmCadenceStepDTO,
} from '@/types/crm-cadence'

export function toCrmCadenceStepDTO(step: CrmCadenceStep): CrmCadenceStepDTO {
  return {
    id: step.id,
    position: step.position,
    type: step.type,
    delayValue: step.delayValue,
    delayUnit: step.delayUnit,
    subject: step.subject,
    body: step.body,
    whatsappTemplateId: step.whatsappTemplateId,
    templateVariables: step.templateVariables,
  }
}

export const EMPTY_CADENCE_STATS: CrmCadenceStatsDTO = {
  enrolled: 0,
  active: 0,
  paused: 0,
  replied: 0,
  completed: 0,
  stopped: 0,
  replyRate: 0,
  sentByStep: [],
}

/** Folds the grouped counts of one cadence into its stats card. */
export function buildCadenceStats(
  enrollments: { status: string; n: number }[],
  runs: { position: number; status: string; n: number }[],
  stepCount: number,
): CrmCadenceStatsDTO {
  const count = (status: string) =>
    enrollments
      .filter((row) => row.status === status)
      .reduce((a, r) => a + r.n, 0)
  const enrolled = enrollments.reduce((acc, row) => acc + row.n, 0)
  const replied = count('REPLIED')
  return {
    enrolled,
    active: count('ACTIVE'),
    paused: count('PAUSED'),
    replied,
    completed: count('COMPLETED'),
    stopped: count('STOPPED'),
    replyRate: enrolled === 0 ? 0 : replied / enrolled,
    sentByStep: Array.from({ length: stepCount }, (_, position) => ({
      position,
      sent: runs
        .filter((row) => row.position === position && row.status === 'SENT')
        .reduce((acc, row) => acc + row.n, 0),
      failed: runs
        .filter((row) => row.position === position && row.status === 'FAILED')
        .reduce((acc, row) => acc + row.n, 0),
    })),
  }
}

export function toCrmCadenceDTO(
  cadence: CrmCadenceWithSteps,
  stats: CrmCadenceStatsDTO | null,
): CrmCadenceDTO {
  return {
    id: cadence.id,
    workspaceId: cadence.workspaceId,
    name: cadence.name,
    description: cadence.description,
    status: cadence.status,
    emailFrom: cadence.emailFrom,
    emailReplyTo: cadence.emailReplyTo,
    whatsappConnectionId: cadence.whatsappConnectionId,
    stopOnReply: cadence.stopOnReply,
    windowStartHour: cadence.windowStartHour,
    windowEndHour: cadence.windowEndHour,
    weekdaysOnly: cadence.weekdaysOnly,
    steps: cadence.steps.map(toCrmCadenceStepDTO),
    stats,
    createdById: cadence.createdById,
    createdAt: cadence.createdAt.toISOString(),
    updatedAt: cadence.updatedAt.toISOString(),
  }
}

export function toCrmCadenceRunDTO(run: CrmCadenceRun): CrmCadenceRunDTO {
  return {
    id: run.id,
    stepId: run.stepId,
    position: run.position,
    type: run.type,
    status: run.status,
    detail: run.detail,
    createdAt: run.createdAt.toISOString(),
  }
}

export function toCrmCadenceEnrollmentDTO(
  enrollment: CrmCadenceEnrollmentView,
): CrmCadenceEnrollmentDTO {
  return {
    id: enrollment.id,
    workspaceId: enrollment.workspaceId,
    cadenceId: enrollment.cadenceId,
    cadenceName: enrollment.cadence.name,
    leadId: enrollment.leadId,
    leadName: enrollment.lead.name,
    status: enrollment.status,
    nextPosition: enrollment.nextPosition,
    totalSteps: enrollment.cadence._count.steps,
    nextRunAt: enrollment.nextRunAt?.toISOString() ?? null,
    stopReason: enrollment.stopReason,
    repliedVia: enrollment.repliedVia,
    enrolledById: enrollment.enrolledById,
    enrolledAt: enrollment.enrolledAt.toISOString(),
    finishedAt: enrollment.finishedAt?.toISOString() ?? null,
    runs: enrollment.runs.map(toCrmCadenceRunDTO),
  }
}
