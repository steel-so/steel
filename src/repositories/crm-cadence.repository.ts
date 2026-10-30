import type {
  CrmCadence,
  CrmCadenceEnrollment,
  CrmCadenceEnrollmentStatus,
  CrmCadenceRun,
  CrmCadenceRunStatus,
  CrmCadenceStatus,
  CrmCadenceStep,
  CrmCadenceStepType,
  CrmCadenceStopReason,
  CrmLead,
  Prisma,
} from '@prisma/client'
import { crmCadenceNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmCadenceStepInput } from '@/src/schemas/crm-cadence.schema'
import { dbError } from './db-error'

/**
 * Sales cadences (slice c1-sales-cadences): the cadence with its steps, the
 * per-lead enrollments and the run history. The worker claims due
 * enrollments with `FOR UPDATE SKIP LOCKED`, so two ticks never run the same
 * enrollment at once; a claim older than the stale window is taken again.
 */

export type CrmCadenceWithSteps = CrmCadence & { steps: CrmCadenceStep[] }

export type CrmCadenceEnrollmentView = CrmCadenceEnrollment & {
  cadence: { name: string; _count: { steps: number } }
  lead: { name: string }
  runs: CrmCadenceRun[]
}

export type CrmCadenceEnrollmentForRun = CrmCadenceEnrollment & {
  cadence: CrmCadenceWithSteps
  lead: CrmLead & { owner: { id: string; name: string; email: string } | null }
}

export interface CadenceFields {
  name: string
  description?: string | null
  emailFrom?: string | null
  emailReplyTo?: string | null
  whatsappConnectionId?: string | null
  stopOnReply: boolean
  stopOnClick: boolean
  windowStartHour?: number | null
  windowEndHour?: number | null
  weekdaysOnly: boolean
}

const stepRows = (
  cadenceId: string,
  workspaceId: string,
  steps: CrmCadenceStepInput[],
) =>
  steps.map((step, position) => ({
    cadenceId,
    workspaceId,
    position,
    type: step.type,
    delayValue: step.delayValue,
    delayUnit: step.delayUnit,
    subject: step.subject ?? null,
    body: step.body,
    whatsappTemplateId: step.whatsappTemplateId ?? null,
    templateVariables: step.templateVariables,
  }))

const enrollmentView = {
  cadence: { select: { name: true, _count: { select: { steps: true } } } },
  lead: { select: { name: true } },
  runs: { orderBy: { createdAt: 'desc' as const }, take: 30 },
} satisfies Prisma.CrmCadenceEnrollmentInclude

export const CrmCadenceRepository = {
  async list(workspaceId: string): Promise<Result<CrmCadenceWithSteps[]>> {
    try {
      const cadences = await prisma.crmCadence.findMany({
        where: { workspaceId, deletedAt: null },
        include: { steps: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })
      return ok(cadences)
    } catch (error) {
      return err(dbError('Failed to list CRM cadences', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCadenceWithSteps>> {
    try {
      const cadence = await prisma.crmCadence.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: { steps: { orderBy: { position: 'asc' } } },
      })
      if (!cadence) return err(crmCadenceNotFound())
      return ok(cadence)
    } catch (error) {
      return err(dbError('Failed to find CRM cadence', error))
    }
  },

  async create(
    workspaceId: string,
    actorId: string,
    fields: CadenceFields,
    steps: CrmCadenceStepInput[],
  ): Promise<Result<CrmCadenceWithSteps>> {
    try {
      const cadence = await prisma.$transaction(async (tx) => {
        const created = await tx.crmCadence.create({
          data: {
            workspaceId,
            createdById: actorId,
            name: fields.name,
            description: fields.description ?? null,
            emailFrom: fields.emailFrom ?? null,
            emailReplyTo: fields.emailReplyTo ?? null,
            whatsappConnectionId: fields.whatsappConnectionId ?? null,
            stopOnReply: fields.stopOnReply,
            stopOnClick: fields.stopOnClick,
            windowStartHour: fields.windowStartHour ?? null,
            windowEndHour: fields.windowEndHour ?? null,
            weekdaysOnly: fields.weekdaysOnly,
          },
        })
        await tx.crmCadenceStep.createMany({
          data: stepRows(created.id, workspaceId, steps),
        })
        return tx.crmCadence.findUniqueOrThrow({
          where: { id: created.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        })
      })
      return ok(cadence)
    } catch (error) {
      return err(dbError('Failed to create CRM cadence', error))
    }
  },

  /** Updates the fields; `steps` (when given) replaces the whole list. */
  async update(
    id: string,
    workspaceId: string,
    actorId: string,
    data: Prisma.CrmCadenceUpdateInput,
    steps?: CrmCadenceStepInput[],
  ): Promise<Result<CrmCadenceWithSteps>> {
    try {
      const cadence = await prisma.$transaction(async (tx) => {
        await tx.crmCadence.update({
          where: { id },
          data: { ...data, updatedById: actorId },
        })
        if (steps) {
          await tx.crmCadenceStep.deleteMany({ where: { cadenceId: id } })
          await tx.crmCadenceStep.createMany({
            data: stepRows(id, workspaceId, steps),
          })
        }
        return tx.crmCadence.findUniqueOrThrow({
          where: { id },
          include: { steps: { orderBy: { position: 'asc' } } },
        })
      })
      return ok(cadence)
    } catch (error) {
      return err(dbError('Failed to update CRM cadence', error))
    }
  },

  async archive(id: string, actorId: string): Promise<Result<void>> {
    try {
      await prisma.crmCadence.update({
        where: { id },
        data: {
          status: 'ARCHIVED' satisfies CrmCadenceStatus,
          deletedAt: new Date(),
          updatedById: actorId,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to archive CRM cadence', error))
    }
  },

  /** Enrollment counts by status, per cadence. */
  async enrollmentCounts(cadenceIds: string[]): Promise<
    Result<
      {
        cadenceId: string
        status: CrmCadenceEnrollmentStatus
        stopReason: CrmCadenceStopReason | null
        n: number
      }[]
    >
  > {
    if (cadenceIds.length === 0) return ok([])
    try {
      const rows = await prisma.crmCadenceEnrollment.groupBy({
        by: ['cadenceId', 'status', 'stopReason'],
        where: { cadenceId: { in: cadenceIds } },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          cadenceId: row.cadenceId,
          status: row.status,
          stopReason: row.stopReason,
          n: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM cadence enrollments', error))
    }
  },

  /** Run counts (sent/failed) by step position, per cadence. */
  async runCounts(cadenceIds: string[]): Promise<
    Result<
      {
        cadenceId: string
        position: number
        status: CrmCadenceRunStatus
        n: number
      }[]
    >
  > {
    if (cadenceIds.length === 0) return ok([])
    try {
      const rows = await prisma.crmCadenceRun.groupBy({
        by: ['cadenceId', 'position', 'status'],
        where: { cadenceId: { in: cadenceIds } },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          cadenceId: row.cadenceId,
          position: row.position,
          status: row.status,
          n: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM cadence runs', error))
    }
  },

  /** Distinct opened/clicked e-mail runs by step position, per cadence. */
  async trackingCounts(cadenceIds: string[]): Promise<
    Result<
      {
        cadenceId: string
        position: number
        opened: number
        clicked: number
      }[]
    >
  > {
    if (cadenceIds.length === 0) return ok([])
    try {
      const rows = await prisma.crmCadenceRun.groupBy({
        by: ['cadenceId', 'position'],
        where: { cadenceId: { in: cadenceIds }, type: 'EMAIL' },
        _count: { openedAt: true, clickedAt: true },
      })
      return ok(
        rows.map((row) => ({
          cadenceId: row.cadenceId,
          position: row.position,
          opened: row._count.openedAt,
          clicked: row._count.clickedAt,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM cadence e-mail tracking', error))
    }
  },

  /** Cadences with `enabled` enrollments that stop on reply: used by lookups. */
  async stopOnReplyEnrollmentIdsByEmail(
    workspaceId: string,
    emails: string[],
  ): Promise<Result<string[]>> {
    if (emails.length === 0) return ok([])
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT e.id
        FROM crm_cadence_enrollments e
        JOIN crm_cadences c ON c.id = e.cadence_id
        JOIN crm_leads l ON l.id = e.lead_id
        WHERE e.workspace_id = ${workspaceId}
          AND e.status IN ('ACTIVE'::"CrmCadenceEnrollmentStatus", 'PAUSED'::"CrmCadenceEnrollmentStatus")
          AND c.stop_on_reply = true
          AND EXISTS (
            SELECT 1 FROM unnest(l.emails) m WHERE lower(m) = ANY(${emails}::text[])
          )`
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(
        dbError('Failed to match CRM cadence enrollments by e-mail', error),
      )
    }
  },

  async stopOnReplyEnrollmentIdsByPhone(
    workspaceId: string,
    phoneDigits: string,
  ): Promise<Result<string[]>> {
    if (phoneDigits.length < 10) return ok([])
    const tail = phoneDigits.slice(-10)
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT e.id
        FROM crm_cadence_enrollments e
        JOIN crm_cadences c ON c.id = e.cadence_id
        JOIN crm_leads l ON l.id = e.lead_id
        WHERE e.workspace_id = ${workspaceId}
          AND e.status IN ('ACTIVE'::"CrmCadenceEnrollmentStatus", 'PAUSED'::"CrmCadenceEnrollmentStatus")
          AND c.stop_on_reply = true
          AND EXISTS (
            SELECT 1 FROM unnest(l.phones) p
            WHERE right(regexp_replace(p, '\\D', '', 'g'), 10) = ${tail}
          )`
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(
        dbError('Failed to match CRM cadence enrollments by phone', error),
      )
    }
  },
}

export const CrmCadenceEnrollmentRepository = {
  async list(
    workspaceId: string,
    filters: {
      cadenceId?: string
      leadId?: string
      status?: CrmCadenceEnrollmentStatus
    },
  ): Promise<Result<CrmCadenceEnrollmentView[]>> {
    try {
      const rows = await prisma.crmCadenceEnrollment.findMany({
        where: {
          workspaceId,
          ...(filters.cadenceId ? { cadenceId: filters.cadenceId } : {}),
          ...(filters.leadId ? { leadId: filters.leadId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        include: enrollmentView,
        orderBy: { enrolledAt: 'desc' },
        take: 500,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM cadence enrollments', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCadenceEnrollmentView | null>> {
    try {
      const row = await prisma.crmCadenceEnrollment.findFirst({
        where: { id, workspaceId },
        include: enrollmentView,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM cadence enrollment', error))
    }
  },

  /**
   * Starts (or restarts, when the previous run ended) the lead on the cadence.
   * `running` = the lead is already active/paused on it: nothing changes.
   */
  async enroll(input: {
    workspaceId: string
    cadenceId: string
    leadId: string
    enrolledById: string
    firstRunAt: Date
  }): Promise<Result<{ id: string; running: boolean }>> {
    try {
      const existing = await prisma.crmCadenceEnrollment.findUnique({
        where: {
          cadenceId_leadId: {
            cadenceId: input.cadenceId,
            leadId: input.leadId,
          },
        },
      })
      if (existing && ['ACTIVE', 'PAUSED'].includes(existing.status)) {
        return ok({ id: existing.id, running: true })
      }
      const data = {
        status: 'ACTIVE' as const,
        nextPosition: 0,
        nextRunAt: input.firstRunAt,
        claimedAt: null,
        stopReason: null,
        repliedVia: null,
        finishedAt: null,
        enrolledById: input.enrolledById,
        enrolledAt: new Date(),
      }
      const row = existing
        ? await prisma.crmCadenceEnrollment.update({
            where: { id: existing.id },
            data,
          })
        : await prisma.crmCadenceEnrollment.create({
            data: {
              workspaceId: input.workspaceId,
              cadenceId: input.cadenceId,
              leadId: input.leadId,
              ...data,
            },
          })
      return ok({ id: row.id, running: false })
    } catch (error) {
      return err(dbError('Failed to enroll lead in CRM cadence', error))
    }
  },

  /** Claims up to `limit` due enrollments (ACTIVE, `nextRunAt` reached). */
  async claimDue(
    now: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<Result<CrmCadenceEnrollmentForRun[]>> {
    try {
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE crm_cadence_enrollments
        SET claimed_at = ${now}
        WHERE id IN (
          SELECT id FROM crm_cadence_enrollments
          WHERE status = 'ACTIVE'::"CrmCadenceEnrollmentStatus"
            AND next_run_at <= ${now}
            AND cadence_id IN (
              SELECT id FROM crm_cadences
              WHERE status = 'ACTIVE'::"CrmCadenceStatus" AND deleted_at IS NULL
            )
            AND (claimed_at IS NULL OR claimed_at < ${staleBefore})
          ORDER BY next_run_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
      if (claimed.length === 0) return ok([])
      const rows = await prisma.crmCadenceEnrollment.findMany({
        where: { id: { in: claimed.map((row) => row.id) } },
        include: {
          cadence: {
            include: { steps: { orderBy: { position: 'asc' } } },
          },
          lead: {
            include: {
              owner: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { nextRunAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to claim due CRM cadence enrollments', error))
    }
  },

  /** Gives the claim back and reschedules (outside the send window, transient failures). */
  async reschedule(id: string, nextRunAt: Date): Promise<Result<void>> {
    try {
      await prisma.crmCadenceEnrollment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { nextRunAt, claimedAt: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reschedule CRM cadence enrollment', error))
    }
  },

  /**
   * Records the step outcome and moves to the next one (or completes) in one
   * transaction. Only applies while the enrollment still waits for that
   * position and is ACTIVE, so a stop that landed meanwhile wins.
   */
  async completeStep(input: {
    enrollmentId: string
    workspaceId: string
    cadenceId: string
    stepId: string
    position: number
    type: CrmCadenceStepType
    status: CrmCadenceRunStatus
    detail?: string | null
    providerMessageId?: string | null
    /** The PENDING row recorded before the send: settled instead of creating one. */
    runId?: string | null
    next: { position: number; runAt: Date } | null
    now: Date
  }): Promise<Result<boolean>> {
    try {
      const applied = await prisma.$transaction(async (tx) => {
        const moved = await tx.crmCadenceEnrollment.updateMany({
          where: {
            id: input.enrollmentId,
            status: 'ACTIVE',
            nextPosition: input.position,
          },
          data: input.next
            ? {
                nextPosition: input.next.position,
                nextRunAt: input.next.runAt,
                claimedAt: null,
              }
            : {
                status: 'COMPLETED',
                nextRunAt: null,
                claimedAt: null,
                finishedAt: input.now,
              },
        })
        if (input.runId) {
          // The message already left: the row is settled even if a stop won.
          await tx.crmCadenceRun.update({
            where: { id: input.runId },
            data: {
              status: input.status,
              detail: input.detail ?? null,
              ...(input.providerMessageId
                ? { providerMessageId: input.providerMessageId }
                : {}),
            },
          })
          return moved.count > 0
        }
        if (moved.count === 0) return false
        await tx.crmCadenceRun.create({
          data: {
            workspaceId: input.workspaceId,
            cadenceId: input.cadenceId,
            enrollmentId: input.enrollmentId,
            stepId: input.stepId,
            position: input.position,
            type: input.type,
            status: input.status,
            detail: input.detail ?? null,
            providerMessageId: input.providerMessageId ?? null,
          },
        })
        return true
      })
      return ok(applied)
    } catch (error) {
      return err(dbError('Failed to complete CRM cadence step', error))
    }
  },

  /**
   * Records the intent to send a step, before sending. The key is unique, so
   * however many times the step is reached (crash, stale claim) there is one
   * row: an existing one comes back untouched with `existed: true` (the
   * previous attempt got at least as far as recording the intent).
   */
  async beginRun(input: {
    workspaceId: string
    cadenceId: string
    enrollmentId: string
    stepId: string
    position: number
    type: CrmCadenceStepType
    idempotencyKey: string
  }): Promise<Result<{ run: CrmCadenceRun; existed: boolean }>> {
    try {
      const found = await prisma.crmCadenceRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      })
      if (found) return ok({ run: found, existed: true })
      try {
        const run = await prisma.crmCadenceRun.create({
          data: { ...input, status: 'PENDING' },
        })
        return ok({ run, existed: false })
      } catch (error) {
        // Lost a race with another writer of the same key: take its row.
        const raced = await prisma.crmCadenceRun.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })
        if (!raced) throw error
        return ok({ run: raced, existed: true })
      }
    } catch (error) {
      return err(dbError('Failed to record CRM cadence step intent', error))
    }
  },

  /** Drops an intent whose send is known not to have happened (transient failure). */
  async discardRun(runId: string): Promise<Result<void>> {
    try {
      await prisma.crmCadenceRun.deleteMany({
        where: { id: runId, status: 'PENDING', providerMessageId: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to discard CRM cadence step intent', error))
    }
  },

  /** Stores the provider id as soon as the send returns, before the bookkeeping. */
  async markRunSent(
    runId: string,
    providerMessageId: string,
  ): Promise<Result<void>> {
    try {
      await prisma.crmCadenceRun.updateMany({
        where: { id: runId, status: 'PENDING' },
        data: { providerMessageId },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to store CRM cadence provider id', error))
    }
  },

  /** Marks the enrollment COMPLETED (no step left) while it is still ACTIVE. */
  async complete(id: string, now: Date): Promise<Result<void>> {
    try {
      await prisma.crmCadenceEnrollment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          nextRunAt: null,
          claimedAt: null,
          finishedAt: now,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to complete CRM cadence enrollment', error))
    }
  },

  /** Ends the enrollment (REPLIED or STOPPED) if it is still open. */
  async finish(
    ids: string[],
    status: Extract<CrmCadenceEnrollmentStatus, 'REPLIED' | 'STOPPED'>,
    reason: CrmCadenceStopReason,
    repliedVia: string | null,
    now: Date,
  ): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const result = await prisma.crmCadenceEnrollment.updateMany({
        where: { id: { in: ids }, status: { in: ['ACTIVE', 'PAUSED'] } },
        data: {
          status,
          stopReason: reason,
          repliedVia,
          nextRunAt: null,
          claimedAt: null,
          finishedAt: now,
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to finish CRM cadence enrollments', error))
    }
  },

  /** Every open enrollment of a cadence (archiving the cadence stops them). */
  async openIdsByCadence(cadenceId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.crmCadenceEnrollment.findMany({
        where: { cadenceId, status: { in: ['ACTIVE', 'PAUSED'] } },
        select: { id: true },
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to list open CRM cadence enrollments', error))
    }
  },

  async pause(id: string): Promise<Result<boolean>> {
    try {
      const result = await prisma.crmCadenceEnrollment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'PAUSED', claimedAt: null },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to pause CRM cadence enrollment', error))
    }
  },

  async resume(id: string, nextRunAt: Date): Promise<Result<boolean>> {
    try {
      const result = await prisma.crmCadenceEnrollment.updateMany({
        where: { id, status: 'PAUSED' },
        data: { status: 'ACTIVE', nextRunAt, claimedAt: null },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to resume CRM cadence enrollment', error))
    }
  },

  async recordRun(input: {
    workspaceId: string
    cadenceId: string
    enrollmentId: string
    stepId?: string | null
    position: number
    type: CrmCadenceStepType
    status: CrmCadenceRunStatus
    detail?: string | null
  }): Promise<Result<void>> {
    try {
      await prisma.crmCadenceRun.create({
        data: {
          workspaceId: input.workspaceId,
          cadenceId: input.cadenceId,
          enrollmentId: input.enrollmentId,
          stepId: input.stepId ?? null,
          position: input.position,
          type: input.type,
          status: input.status,
          detail: input.detail ?? null,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM cadence run', error))
    }
  },
}

/** Open/click tracking of the cadence e-mail runs. */
export type CrmCadenceRunForTracking = CrmCadenceRun & {
  cadence: { stopOnClick: boolean }
  enrollment: { status: CrmCadenceEnrollmentStatus }
}

export const CrmCadenceRunRepository = {
  async findForTracking(
    runId: string,
  ): Promise<Result<CrmCadenceRunForTracking | null>> {
    try {
      const row = await prisma.crmCadenceRun.findFirst({
        where: { id: runId, type: 'EMAIL' },
        include: {
          cadence: { select: { stopOnClick: true } },
          enrollment: { select: { status: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load CRM cadence run', error))
    }
  },

  /** Counts the open; the first one also stamps `openedAt`. */
  async recordOpen(runId: string, now: Date): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.crmCadenceRun.updateMany({
          where: { id: runId, openedAt: null },
          data: { openedAt: now },
        }),
        prisma.crmCadenceRun.updateMany({
          where: { id: runId },
          data: { openCount: { increment: 1 } },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM cadence e-mail open', error))
    }
  },

  /** Counts the click; the first one stamps `clickedAt` (and `openedAt` if blocked images hid the open). */
  async recordClick(runId: string, now: Date): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.crmCadenceRun.updateMany({
          where: { id: runId, clickedAt: null },
          data: { clickedAt: now },
        }),
        prisma.crmCadenceRun.updateMany({
          where: { id: runId, openedAt: null },
          data: { openedAt: now },
        }),
        prisma.crmCadenceRun.updateMany({
          where: { id: runId },
          data: { clickCount: { increment: 1 } },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM cadence e-mail click', error))
    }
  },
}

/** Opt-out lookups used before each send (1:1 messages still honour them). */
export const CrmCadenceLookupRepository = {
  async emailOptedOut(
    workspaceId: string,
    email: string,
  ): Promise<Result<boolean>> {
    try {
      const found = await prisma.crmEmailOptOut.findUnique({
        where: {
          workspaceId_email: { workspaceId, email: email.trim().toLowerCase() },
        },
        select: { id: true },
      })
      return ok(found !== null)
    } catch (error) {
      return err(dbError('Failed to check CRM e-mail opt-out', error))
    }
  },

  async whatsappOptedOut(
    workspaceId: string,
    waId: string,
  ): Promise<Result<boolean>> {
    try {
      const contact = await prisma.whatsAppContact.findUnique({
        where: { workspaceId_waId: { workspaceId, waId } },
        select: { broadcastOptedOutAt: true },
      })
      return ok(contact?.broadcastOptedOutAt != null)
    } catch (error) {
      return err(dbError('Failed to check WhatsApp opt-out', error))
    }
  },

  /** Leads of the workspace that can be enrolled (not deleted, not closed). */
  async findLeads(
    workspaceId: string,
    leadIds: string[],
  ): Promise<
    Result<
      {
        id: string
        name: string
        stage: string
        emails: string[]
        phones: string[]
      }[]
    >
  > {
    try {
      const leads = await prisma.crmLead.findMany({
        where: { id: { in: leadIds }, workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          stage: true,
          emails: true,
          phones: true,
        },
      })
      return ok(leads)
    } catch (error) {
      return err(dbError('Failed to find CRM leads for cadence', error))
    }
  },
}
