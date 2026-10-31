import type {
  Prisma,
  QaReview,
  WhatsAppConversation,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  forbidden,
  qaDisabled,
  qaReviewNotFound,
  qaSubjectNotFound,
} from '@/src/errors'
import {
  criteriaForSubject,
  isLowScore,
  weightedScore,
} from '@/src/lib/qa/criteria'
import {
  buildQaSystemPrompt,
  buildQaUserMessage,
  parseQaJudgement,
  QA_JUDGE_SCHEMA,
} from '@/src/lib/qa/prompts'
import {
  buildConversationTranscript,
  buildTicketTranscript,
  type QaTranscript,
} from '@/src/lib/qa/transcript'
import { QaReviewJob } from '@/src/lib/queue/jobs'
import { getQaReviewQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildQaCoaching,
  toQaConfigDTO,
  toQaReviewDTO,
} from '@/src/mappers/qa-review.mapper'
import { QaReviewRepository } from '@/src/repositories/qa-review.repository'
import { QaReviewSourceRepository } from '@/src/repositories/qa-review-source.repository'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import type {
  CreateQaReviewDTO,
  QaCoachingQueryDTO,
  QaReviewListQueryDTO,
  UpdateQaConfigDTO,
} from '@/src/schemas/qa-review.schema'
import type {
  QaConfigDTO,
  QaCoachingDTO,
  QaReviewDTO,
  QaReviewListDTO,
} from '@/types/qa-review'
import { AiUsageService } from './ai-usage.service'
import {
  assertMember,
  assertModuleEnabled,
  type MembershipContext,
} from './authz'
import { emitNotification, workspaceAdminIds } from './notification-emitter'

/** Wait before the review so late messages and the closing note are in. */
const REVIEW_DELAY_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_COACHING_DAYS = 30

export type QaRunOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'completed'; score: number; lowScore: boolean }

/** Participation in at least one of the two modules the QA reads. */
async function assertQaAccess(
  actorId: string,
  workspaceId: string,
): Promise<Result<MembershipContext>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership
  const [communication, serviceDesk] = await Promise.all([
    assertModuleEnabled(workspaceId, 'COMMUNICATION'),
    assertModuleEnabled(workspaceId, 'SERVICE_DESK'),
  ])
  if (!communication.ok && !serviceDesk.ok) return communication
  return membership
}

async function assertQaPrivileged(
  actorId: string,
  workspaceId: string,
): Promise<Result<MembershipContext>> {
  const access = await assertQaAccess(actorId, workspaceId)
  if (!access.ok) return access
  if (!access.value.isPrivileged) return err(forbidden())
  return access
}

async function loadConfig(workspaceId: string): Promise<Result<QaConfigDTO>> {
  const [config, criteria] = await Promise.all([
    QaReviewRepository.findConfig(workspaceId),
    QaReviewRepository.listCriteria(workspaceId),
  ])
  if (!config.ok) return config
  if (!criteria.ok) return criteria
  return ok(toQaConfigDTO(config.value, criteria.value))
}

function prepareFailureReason(code: string): string {
  if (code === 'AI_QUOTA_EXCEEDED') return 'ai_quota_exceeded'
  if (code === 'AI_PROVIDER_UNAVAILABLE') return 'ai_provider_unavailable'
  return 'ai_prepare_failed'
}

async function enqueue(reviewId: string, delayMs: number): Promise<void> {
  await getQaReviewQueue().add(
    QaReviewJob.Review,
    { reviewId },
    { jobId: `qa-review-${reviewId}-${Date.now()}`, delay: delayMs },
  )
}

async function finish(
  id: string,
  data: Parameters<typeof QaReviewRepository.update>[1],
): Promise<Result<true>> {
  const updated = await QaReviewRepository.update(id, data)
  return updated.ok ? ok(true as const) : updated
}

async function agentIdentity(
  transcript: QaTranscript,
  owner: { id: string | null; name: string | null },
): Promise<{ id: string | null; name: string | null }> {
  // Bot-only attendances belong to no person: they get the "Bot" row.
  if (transcript.handlerKind === 'BOT') return { id: null, name: null }
  const id = owner.id ?? transcript.fallbackAgentId
  if (!id) return { id: null, name: null }
  if (owner.name) return { id, name: owner.name }
  const user = await UserRepository.findById(id)
  return { id, name: user.ok ? user.value.name : null }
}

/** Fire-and-forget alert to the managers; never fails the review. */
async function alertLowScore(
  review: QaReview,
  score: number,
  threshold: number,
): Promise<void> {
  try {
    const admins = await workspaceAdminIds(review.workspaceId)
    const notified = await emitNotification({
      workspaceId: review.workspaceId,
      recipients: admins,
      actorId: null,
      kind: 'QA_LOW_SCORE',
      title: `Nota baixa no QA: ${score}/100`,
      body: `${
        review.subjectType === 'TICKET' ? 'O chamado' : 'A conversa'
      }${review.subjectLabel ? ` ${review.subjectLabel}` : ''}${
        review.agentName ? ` atendido por ${review.agentName}` : ''
      } ficou abaixo do mínimo de ${threshold}.`,
      path: `/ai/qualidade?review=${review.id}`,
      dedupeKey: `qa-low-score:${review.id}`,
    })
    auditMutation({
      entity: 'qa_review',
      action: 'alert',
      actorId: null,
      targetId: review.id,
      meta: { workspaceId: review.workspaceId, score, notified },
    })
  } catch (error) {
    logger.warn('qa_review.alert_failed', {
      workspaceId: review.workspaceId,
      reviewId: review.id,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

export const QaReviewService = {
  // ── Admin (settings, list, coaching, manual review) ─────────────────────

  async getConfig(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<QaConfigDTO>> {
    const access = await assertQaAccess(actorId, workspaceId)
    if (!access.ok) return access
    return loadConfig(workspaceId)
  },

  async updateConfig(
    actorId: string,
    workspaceId: string,
    dto: UpdateQaConfigDTO,
  ): Promise<Result<QaConfigDTO>> {
    const access = await assertQaPrivileged(actorId, workspaceId)
    if (!access.ok) return access

    const { criteria, ...fields } = dto
    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    )
    const saved = await QaReviewRepository.upsertConfig(workspaceId, defined)
    if (!saved.ok) return saved
    if (criteria) {
      const replaced = await QaReviewRepository.replaceCriteria(
        workspaceId,
        criteria,
      )
      if (!replaced.ok) return replaced
    }
    auditMutation({
      entity: 'qa_config',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { workspaceId, fields: Object.keys(defined), criteria: !!criteria },
    })
    return loadConfig(workspaceId)
  },

  async list(
    actorId: string,
    workspaceId: string,
    query: QaReviewListQueryDTO,
  ): Promise<Result<QaReviewListDTO>> {
    const access = await assertQaAccess(actorId, workspaceId)
    if (!access.ok) return access
    // Agents see their own scores; managers see everyone's.
    const agentUserId = access.value.isPrivileged ? query.agentUserId : actorId
    const { cursor, limit, ...filters } = query
    const page = await QaReviewRepository.list(
      workspaceId,
      { ...filters, agentUserId },
      { cursor, limit },
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toQaReviewDTO),
      nextCursor: page.value.nextCursor,
    })
  },

  async get(
    actorId: string,
    workspaceId: string,
    reviewId: string,
  ): Promise<Result<QaReviewDTO>> {
    const access = await assertQaAccess(actorId, workspaceId)
    if (!access.ok) return access
    const found = await QaReviewRepository.findInWorkspace(
      workspaceId,
      reviewId,
    )
    if (!found.ok) return found
    if (!found.value) return err(qaReviewNotFound())
    if (!access.value.isPrivileged && found.value.agentUserId !== actorId) {
      return err(forbidden())
    }
    return ok(toQaReviewDTO(found.value))
  },

  async coaching(
    actorId: string,
    workspaceId: string,
    query: QaCoachingQueryDTO,
  ): Promise<Result<QaCoachingDTO>> {
    const access = await assertQaAccess(actorId, workspaceId)
    if (!access.ok) return access
    const to = query.to ?? new Date()
    const from =
      query.from ?? new Date(to.getTime() - DEFAULT_COACHING_DAYS * DAY_MS)
    const agentUserId = access.value.isPrivileged ? query.agentUserId : actorId
    const rows = await QaReviewRepository.listCompleted(
      workspaceId,
      { from, to },
      agentUserId,
    )
    if (!rows.ok) return rows
    return ok(buildQaCoaching(rows.value.map(toQaReviewDTO), { from, to }))
  },

  /** Manual (re)review of one conversation or ticket. */
  async requestReview(
    actorId: string,
    workspaceId: string,
    dto: CreateQaReviewDTO,
  ): Promise<Result<QaReviewDTO>> {
    const access = await assertQaPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const config = await loadConfig(workspaceId)
    if (!config.ok) return config
    if (!config.value.enabled) return err(qaDisabled())

    const seed =
      dto.subjectType === 'CONVERSATION'
        ? await conversationSeed(workspaceId, dto.subjectId)
        : await ticketSeed(workspaceId, dto.subjectId)
    if (!seed.ok) return seed
    const review = await QaReviewRepository.upsertPending(seed.value)
    if (!review.ok) return review
    await enqueue(review.value.id, 0)
    auditMutation({
      entity: 'qa_review',
      action: 'create',
      actorId,
      targetId: review.value.id,
      meta: { workspaceId, subjectType: dto.subjectType },
    })
    return ok(toQaReviewDTO(review.value))
  },

  // ── Triggers (system) ───────────────────────────────────────────────────

  /**
   * A zap conversation was closed: schedules its review when the QA is on.
   * Never throws; a failure is returned for the caller to log.
   */
  async onConversationClosed(
    conversation: Pick<
      WhatsAppConversation,
      'id' | 'workspaceId' | 'firstInboundAt'
    >,
  ): Promise<Result<QaReview | null>> {
    const config = await QaReviewRepository.findConfig(conversation.workspaceId)
    if (!config.ok) return config
    if (!config.value?.enabled || !config.value.reviewConversations) {
      return ok(null)
    }
    // The contact never wrote (broadcast only): nothing was attended.
    if (!conversation.firstInboundAt) return ok(null)
    const review = await QaReviewRepository.upsertPending({
      workspaceId: conversation.workspaceId,
      subjectType: 'CONVERSATION',
      conversationId: conversation.id,
      subjectEndedAt: new Date(),
    })
    if (!review.ok) return review
    await enqueue(review.value.id, REVIEW_DELAY_MS)
    return ok(review.value)
  },

  /** A ServiceDesk ticket reached RESOLVED/CLOSED: schedules its review. */
  async onTicketResolved(
    ticket: Pick<SdTicketWithRelations, 'id' | 'workspaceId'>,
  ): Promise<Result<QaReview | null>> {
    const config = await QaReviewRepository.findConfig(ticket.workspaceId)
    if (!config.ok) return config
    if (!config.value?.enabled || !config.value.reviewTickets) return ok(null)
    const review = await QaReviewRepository.upsertPending({
      workspaceId: ticket.workspaceId,
      subjectType: 'TICKET',
      ticketId: ticket.id,
      subjectEndedAt: new Date(),
    })
    if (!review.ok) return review
    await enqueue(review.value.id, REVIEW_DELAY_MS)
    return ok(review.value)
  },

  // ── Review (worker) ─────────────────────────────────────────────────────

  /**
   * Scores one attendance with the configured criteria. System flow (no
   * user): uses the workspace model and respects the monthly AI quota —
   * when it is spent the review is SKIPPED (and can be re-requested).
   * A database failure is the only error (the job retries).
   */
  async run(reviewId: string): Promise<Result<QaRunOutcome>> {
    const found = await QaReviewRepository.findById(reviewId)
    if (!found.ok) return found
    const review = found.value
    if (review?.status !== 'PENDING') {
      return ok({ status: 'skipped', reason: 'not_pending' })
    }

    const skip = async (reason: string): Promise<Result<QaRunOutcome>> => {
      const saved = await finish(review.id, {
        status: 'SKIPPED',
        skipReason: reason,
        reviewedAt: new Date(),
      })
      return saved.ok ? ok({ status: 'skipped', reason }) : saved
    }

    const config = await loadConfig(review.workspaceId)
    if (!config.ok) return config
    if (!config.value.enabled) return skip('disabled')

    const source =
      review.subjectType === 'CONVERSATION' && review.conversationId
        ? await loadConversation(review.workspaceId, review.conversationId)
        : review.ticketId
          ? await loadTicket(review.workspaceId, review.ticketId)
          : ok(null)
    if (!source.ok) return source
    if (!source.value) return skip('subject_not_found')
    const { transcript, owner, customerName, label, endedAt } = source.value

    if (transcript.handlerKind === null) return skip('no_attendant_reply')
    if (transcript.messageCount < config.value.minMessages) {
      return skip('too_short')
    }
    if (transcript.handlerKind === 'BOT' && !config.value.includeBots) {
      return skip('bots_excluded')
    }
    const criteria = criteriaForSubject(
      config.value.criteria,
      review.subjectType,
    )
    if (criteria.length === 0) return skip('no_criteria')

    const agent = await agentIdentity(transcript, owner)
    const prepared = await AiUsageService.prepare(
      review.workspaceId,
      'QA_REVIEW',
      null,
    )
    if (!prepared.ok) return skip(prepareFailureReason(prepared.error.code))
    const call = prepared.value

    const base = {
      handlerKind: transcript.handlerKind,
      agentUserId: agent.id,
      agentName: agent.name,
      customerName,
      subjectLabel: label ?? review.subjectLabel,
      subjectEndedAt: endedAt ?? review.subjectEndedAt,
      provider: call.model.provider,
      model: call.model.model,
    }

    let text: string
    let usage: { inputTokens: number; outputTokens: number }
    try {
      const response = await call.provider.chat({
        model: call.model.model,
        system: buildQaSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: buildQaUserMessage({
              subjectType: review.subjectType,
              subjectLabel: base.subjectLabel,
              handlerKind: transcript.handlerKind,
              criteria,
              lines: transcript.lines,
            }),
          },
        ],
        jsonSchema: QA_JUDGE_SCHEMA,
        maxTokens: 1_500,
      })
      text = response.text
      usage = response.usage
    } catch (error) {
      logger.warn('qa_review.provider_failed', {
        workspaceId: review.workspaceId,
        reviewId: review.id,
        cause: error instanceof Error ? error.message : String(error),
      })
      const saved = await finish(review.id, {
        ...base,
        status: 'FAILED',
        skipReason: 'provider_failed',
        reviewedAt: new Date(),
      })
      return saved.ok
        ? ok({ status: 'failed', reason: 'provider_failed' })
        : saved
    }

    const costUsd = AiUsageService.price(call, usage)
    await AiUsageService.record(call, {
      workspaceId: review.workspaceId,
      userId: null,
      usage,
    })
    const usageData = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
    }

    const judgement = parseQaJudgement(text, criteria)
    const score = judgement ? weightedScore(judgement.criteria) : null
    if (!judgement || score === null) {
      const saved = await finish(review.id, {
        ...base,
        ...usageData,
        status: 'FAILED',
        skipReason: 'unparseable_response',
        reviewedAt: new Date(),
      })
      return saved.ok
        ? ok({ status: 'failed', reason: 'unparseable_response' })
        : saved
    }

    const lowScore = isLowScore(score, config.value.lowScoreThreshold)
    const updated = await QaReviewRepository.update(review.id, {
      ...base,
      ...usageData,
      status: 'COMPLETED',
      skipReason: null,
      score,
      summary: judgement.summary,
      criteriaResults: judgement.criteria as unknown as Prisma.InputJsonValue,
      coachingTips: judgement.coachingTips,
      lowScore,
      reviewedAt: new Date(),
    })
    if (!updated.ok) return updated

    if (lowScore && config.value.alertLowScore) {
      await alertLowScore(updated.value, score, config.value.lowScoreThreshold)
    }
    return ok({ status: 'completed', score, lowScore })
  },
}

// ── Subject loading ─────────────────────────────────────────────────────────

interface LoadedSubject {
  transcript: QaTranscript
  owner: { id: string | null; name: string | null }
  customerName: string | null
  label: string | null
  endedAt: Date | null
}

async function loadConversation(
  workspaceId: string,
  id: string,
): Promise<Result<LoadedSubject | null>> {
  const source = await QaReviewSourceRepository.loadConversation(
    workspaceId,
    id,
  )
  if (!source.ok) return source
  if (!source.value) return ok(null)
  return ok({
    transcript: buildConversationTranscript(source.value),
    owner: {
      id: source.value.assignedUserId,
      name: source.value.assignedUserName,
    },
    customerName: source.value.customerName,
    label: null,
    endedAt: source.value.endedAt,
  })
}

async function loadTicket(
  workspaceId: string,
  id: string,
): Promise<Result<LoadedSubject | null>> {
  const source = await QaReviewSourceRepository.loadTicket(workspaceId, id)
  if (!source.ok) return source
  if (!source.value) return ok(null)
  return ok({
    transcript: buildTicketTranscript(source.value),
    owner: { id: source.value.assigneeId, name: source.value.assigneeName },
    customerName: source.value.customerName,
    label: source.value.label,
    endedAt: source.value.endedAt,
  })
}

async function conversationSeed(workspaceId: string, id: string) {
  const source = await QaReviewSourceRepository.loadConversation(
    workspaceId,
    id,
  )
  if (!source.ok) return source
  if (!source.value) return err(qaSubjectNotFound())
  return ok({
    workspaceId,
    subjectType: 'CONVERSATION' as const,
    conversationId: id,
    subjectEndedAt: source.value.endedAt,
  })
}

async function ticketSeed(workspaceId: string, id: string) {
  const source = await QaReviewSourceRepository.loadTicket(workspaceId, id)
  if (!source.ok) return source
  if (!source.value) return err(qaSubjectNotFound())
  return ok({
    workspaceId,
    subjectType: 'TICKET' as const,
    ticketId: id,
    subjectLabel: source.value.label,
    subjectEndedAt: source.value.endedAt,
  })
}
