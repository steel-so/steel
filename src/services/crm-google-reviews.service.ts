import { auditMutation } from '@/lib/axiom/audit'
import {
  crmGoogleReviewNotFound,
  crmSocialConnectionNotFound,
} from '@/src/errors'
import {
  buildReplySystem,
  buildReplyUserMessage,
  fitToLimit,
} from '@/src/lib/google-business/ai-prompts'
import {
  deleteReviewReply,
  putReviewReply,
} from '@/src/lib/google-business/client'
import { buildSummary } from '@/src/lib/google-business/reviews'
import { err, ok, type Result } from '@/src/lib/result'
import { toGoogleReviewDTO } from '@/src/mappers/crm-google-presence.mapper'
import {
  CrmGoogleConnectionRepository,
  CrmGoogleReviewRepository,
} from '@/src/repositories/crm-google-presence.repository'
import {
  GOOGLE_REPLY_MAX,
  type GoogleReviewDTO,
  type GoogleReviewSuggestionDTO,
  type GoogleReviewsPageDTO,
  type GoogleReviewsSummaryDTO,
  type ListGoogleReviewsQuery,
} from '@/src/schemas/crm-google-presence.schema'
import { assertModuleMember } from './authz'
import { runGoogleSuggestion } from './crm-google-ai'
import { syncReviews } from './crm-google-sync.service'
import { googleLocationAccessFor } from './crm-google-token'

const SOCIAL = 'social' as const

export const CrmGoogleReviewsService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListGoogleReviewsQuery,
  ): Promise<Result<GoogleReviewsPageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const connection =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!connection.ok) return connection
    if (!connection.value) {
      return ok({
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: 1,
      })
    }

    const page = await CrmGoogleReviewRepository.list(
      connection.value.id,
      { rating: query.rating, replied: query.replied, q: query.q },
      query.page,
      query.pageSize,
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toGoogleReviewDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(page.value.total / query.pageSize)),
    })
  },

  async summary(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleReviewsSummaryDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const connection =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!connection.ok) return connection
    if (!connection.value) return err(crmSocialConnectionNotFound())

    const rows = await CrmGoogleReviewRepository.listForSummary(
      connection.value.id,
    )
    if (!rows.ok) return rows
    return ok(
      buildSummary({
        reviews: rows.value.map((row) => ({
          starRating: row.starRating,
          reviewedAt: row.reviewedAt,
          hasReply: row.replyComment !== null,
        })),
        averageRating: connection.value.averageRating,
        totalReviewCount: connection.value.totalReviewCount,
        lastSyncAt: connection.value.lastReviewsSyncAt,
      }),
    )
  },

  /** "Atualizar agora": reads every page of reviews from Google. */
  async sync(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<{ synced: number; created: number }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const result = await syncReviews(access.value.connection)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_google_review',
      action: 'sync',
      actorId,
      meta: {
        workspaceId,
        synced: result.value.synced,
        created: result.value.created,
      },
    })
    return ok({ synced: result.value.synced, created: result.value.created })
  },

  async reply(
    actorId: string,
    workspaceId: string,
    reviewId: string,
    comment: string,
  ): Promise<Result<GoogleReviewDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const review = await CrmGoogleReviewRepository.findByGoogleId(
      access.value.connection.id,
      reviewId,
    )
    if (!review.ok) return err(crmGoogleReviewNotFound())

    const sent = await putReviewReply(
      access.value.accessToken,
      access.value.fullLocationName,
      reviewId,
      comment,
    )
    if (!sent.ok) {
      auditMutation({
        entity: 'crm_google_review',
        action: 'send',
        actorId,
        targetId: reviewId,
        outcome: 'failure',
        reason: sent.error.code,
        meta: { workspaceId },
      })
      return sent
    }

    const saved = await CrmGoogleReviewRepository.setReply(review.value.id, {
      comment: sent.value.comment ?? comment,
      updatedAt: sent.value.updateTime
        ? new Date(sent.value.updateTime)
        : new Date(),
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_google_review',
      action: 'send',
      actorId,
      targetId: reviewId,
      meta: {
        workspaceId,
        starRating: review.value.starRating,
        edited: review.value.replyComment !== null,
      },
    })
    return ok(toGoogleReviewDTO(saved.value))
  },

  async deleteReply(
    actorId: string,
    workspaceId: string,
    reviewId: string,
  ): Promise<Result<GoogleReviewDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const review = await CrmGoogleReviewRepository.findByGoogleId(
      access.value.connection.id,
      reviewId,
    )
    if (!review.ok) return err(crmGoogleReviewNotFound())

    const removed = await deleteReviewReply(
      access.value.accessToken,
      access.value.fullLocationName,
      reviewId,
    )
    if (!removed.ok) return removed

    const saved = await CrmGoogleReviewRepository.setReply(
      review.value.id,
      null,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_google_review',
      action: 'delete',
      actorId,
      targetId: reviewId,
      meta: { workspaceId },
    })
    return ok(toGoogleReviewDTO(saved.value))
  },

  /** AI draft of the reply, in the brand's tone. Nothing is sent to Google. */
  async suggestReply(
    actorId: string,
    workspaceId: string,
    reviewId: string,
  ): Promise<Result<GoogleReviewSuggestionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const connection =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!connection.ok) return connection
    if (!connection.value) return err(crmSocialConnectionNotFound())

    const review = await CrmGoogleReviewRepository.findByGoogleId(
      connection.value.id,
      reviewId,
    )
    if (!review.ok) return err(crmGoogleReviewNotFound())

    const suggestion = await runGoogleSuggestion({
      actorId,
      workspaceId,
      surface: 'review_reply',
      system: buildReplySystem({
        businessName: connection.value.locationTitle ?? 'nossa empresa',
        tone: connection.value.replyTone,
        starRating: review.value.starRating,
      }),
      user: buildReplyUserMessage({
        reviewerName: review.value.reviewerName,
        starRating: review.value.starRating,
        comment: review.value.comment,
      }),
    })
    if (!suggestion.ok) return suggestion
    return ok({ suggestion: fitToLimit(suggestion.value, GOOGLE_REPLY_MAX) })
  },
}
