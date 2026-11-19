import type {
  CrmGoogleBusinessConnection,
  CrmGoogleBusinessDailyMetric,
  CrmGoogleReview,
  CrmSocialConnectionStatus,
  Prisma,
} from '@prisma/client'
import { notFound } from '@/src/errors'
import type { DailyMetricRow } from '@/src/lib/google-business/metrics'
import type { ReviewCacheInput } from '@/src/lib/google-business/reviews'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type GoogleLocationSelection = {
  accountName: string
  locationName: string
  locationTitle: string
  placeId: string | null
  mapsUri: string | null
  newReviewUri: string | null
}

export const CrmGoogleConnectionRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<CrmGoogleBusinessConnection | null>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessConnection.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find Google Business connection', error))
    }
  },

  /** Connections the worker should sync: connected, with a location chosen. */
  async listSyncable(): Promise<Result<CrmGoogleBusinessConnection[]>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessConnection.findMany({
          where: { status: 'CONNECTED', locationName: { not: null } },
          orderBy: { lastReviewsSyncAt: { sort: 'asc', nulls: 'first' } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list Google Business connections', error))
    }
  },

  /**
   * Stores the tokens of a (re)connection. Reconnecting keeps the chosen
   * location, the reply tone and the cached reviews; a refresh token is only
   * overwritten when Google sent a new one.
   */
  async upsertOAuth(data: {
    workspaceId: string
    connectedById: string
    googleEmail: string | null
    accessToken: string
    refreshToken: string | null
    tokenExpiresAt: Date | null
    scope: string | null
  }): Promise<Result<CrmGoogleBusinessConnection>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessConnection.upsert({
          where: { workspaceId: data.workspaceId },
          create: { ...data, status: 'CONNECTED' },
          update: {
            connectedById: data.connectedById,
            googleEmail: data.googleEmail,
            accessToken: data.accessToken,
            tokenExpiresAt: data.tokenExpiresAt,
            scope: data.scope,
            status: 'CONNECTED',
            lastSyncError: null,
            ...(data.refreshToken && { refreshToken: data.refreshToken }),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert Google Business connection', error))
    }
  },

  async updateTokens(
    id: string,
    data: {
      accessToken: string
      refreshToken?: string
      tokenExpiresAt: Date | null
      scope: string | null
    },
  ): Promise<Result<CrmGoogleBusinessConnection>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessConnection.update({
          where: { id },
          data: {
            accessToken: data.accessToken,
            tokenExpiresAt: data.tokenExpiresAt,
            ...(data.refreshToken && { refreshToken: data.refreshToken }),
            ...(data.scope && { scope: data.scope }),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update Google Business tokens', error))
    }
  },

  async setStatus(
    id: string,
    status: CrmSocialConnectionStatus,
  ): Promise<Result<void>> {
    try {
      await prisma.crmGoogleBusinessConnection.update({
        where: { id },
        data: { status },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to set Google Business status', error))
    }
  },

  /**
   * Chooses the managed location. Switching to a different one drops the
   * cache of the old location (reviews and metrics belong to one place).
   */
  async setLocation(
    id: string,
    selection: GoogleLocationSelection,
  ): Promise<Result<CrmGoogleBusinessConnection>> {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.crmGoogleBusinessConnection.findUnique({
          where: { id },
          select: { locationName: true },
        })
        if (current?.locationName !== selection.locationName) {
          await tx.crmGoogleReview.deleteMany({ where: { connectionId: id } })
          await tx.crmGoogleBusinessDailyMetric.deleteMany({
            where: { connectionId: id },
          })
        }
        return tx.crmGoogleBusinessConnection.update({
          where: { id },
          data: {
            ...selection,
            ...(current?.locationName !== selection.locationName && {
              averageRating: null,
              totalReviewCount: null,
              lastReviewsSyncAt: null,
              lastMetricsSyncAt: null,
              lastSyncError: null,
            }),
          },
        })
      })
      return ok(updated)
    } catch (error) {
      return err(dbError('Failed to set Google Business location', error))
    }
  },

  async updateReplyTone(
    id: string,
    replyTone: string | null,
  ): Promise<Result<CrmGoogleBusinessConnection>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessConnection.update({
          where: { id },
          data: { replyTone: replyTone || null },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update Google reply tone', error))
    }
  },

  async recordSync(
    id: string,
    data: {
      averageRating?: number | null
      totalReviewCount?: number | null
      lastReviewsSyncAt?: Date
      lastMetricsSyncAt?: Date
      lastSyncError: string | null
    },
  ): Promise<Result<void>> {
    try {
      await prisma.crmGoogleBusinessConnection.update({
        where: { id },
        data,
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record Google Business sync', error))
    }
  },

  async removeByWorkspace(workspaceId: string): Promise<Result<void>> {
    try {
      await prisma.crmGoogleBusinessConnection.deleteMany({
        where: { workspaceId },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to remove Google Business connection', error))
    }
  },
}

export type GoogleReviewFilters = {
  rating?: number
  replied?: 'yes' | 'no'
  q?: string
}

function reviewWhere(
  connectionId: string,
  filters: GoogleReviewFilters,
): Prisma.CrmGoogleReviewWhereInput {
  return {
    connectionId,
    ...(filters.rating !== undefined && { starRating: filters.rating }),
    ...(filters.replied === 'yes' && { replyComment: { not: null } }),
    ...(filters.replied === 'no' && { replyComment: null }),
    ...(filters.q && {
      OR: [
        { comment: { contains: filters.q, mode: 'insensitive' } },
        { reviewerName: { contains: filters.q, mode: 'insensitive' } },
      ],
    }),
  }
}

export const CrmGoogleReviewRepository = {
  async list(
    connectionId: string,
    filters: GoogleReviewFilters,
    page: number,
    pageSize: number,
  ): Promise<Result<{ items: CrmGoogleReview[]; total: number }>> {
    try {
      const where = reviewWhere(connectionId, filters)
      const [items, total] = await Promise.all([
        prisma.crmGoogleReview.findMany({
          where,
          orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.crmGoogleReview.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list Google reviews', error))
    }
  },

  async findByGoogleId(
    connectionId: string,
    googleReviewId: string,
  ): Promise<Result<CrmGoogleReview>> {
    try {
      const review = await prisma.crmGoogleReview.findUnique({
        where: {
          connectionId_googleReviewId: { connectionId, googleReviewId },
        },
      })
      if (!review) return err(notFound('CrmGoogleReview'))
      return ok(review)
    } catch (error) {
      return err(dbError('Failed to find Google review', error))
    }
  },

  /** Every cached review, slimmed down for the rollups. */
  async listForSummary(
    connectionId: string,
  ): Promise<
    Result<
      Pick<CrmGoogleReview, 'starRating' | 'reviewedAt' | 'replyComment'>[]
    >
  > {
    try {
      return ok(
        await prisma.crmGoogleReview.findMany({
          where: { connectionId },
          select: { starRating: true, reviewedAt: true, replyComment: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to summarize Google reviews', error))
    }
  },

  /**
   * Inserts new reviews and refreshes the changed ones. Returns the rows
   * that did not exist before — the candidates for a negative-review alert.
   */
  async upsertMany(
    connectionId: string,
    workspaceId: string,
    inputs: ReviewCacheInput[],
  ): Promise<Result<CrmGoogleReview[]>> {
    if (inputs.length === 0) return ok([])
    try {
      const existing = await prisma.crmGoogleReview.findMany({
        where: {
          connectionId,
          googleReviewId: { in: inputs.map((i) => i.googleReviewId) },
        },
      })
      const known = new Map(existing.map((r) => [r.googleReviewId, r]))

      const fresh = inputs.filter((i) => !known.has(i.googleReviewId))
      const changed = inputs.filter((i) => {
        const row = known.get(i.googleReviewId)
        return (
          row !== undefined &&
          (row.googleUpdatedAt.getTime() !== i.googleUpdatedAt.getTime() ||
            row.replyComment !== i.replyComment ||
            row.starRating !== i.starRating)
        )
      })

      const created = await prisma.$transaction([
        ...fresh.map((input) =>
          prisma.crmGoogleReview.create({
            data: { ...input, connectionId, workspaceId },
          }),
        ),
        ...changed.map((input) =>
          prisma.crmGoogleReview.update({
            where: {
              connectionId_googleReviewId: {
                connectionId,
                googleReviewId: input.googleReviewId,
              },
            },
            data: {
              reviewerName: input.reviewerName,
              reviewerPhotoUrl: input.reviewerPhotoUrl,
              starRating: input.starRating,
              comment: input.comment,
              googleUpdatedAt: input.googleUpdatedAt,
              replyComment: input.replyComment,
              replyUpdatedAt: input.replyUpdatedAt,
            },
          }),
        ),
      ])
      return ok(created.slice(0, fresh.length))
    } catch (error) {
      return err(dbError('Failed to upsert Google reviews', error))
    }
  },

  /** After a full sync: drops reviews that no longer exist on Google. */
  async deleteMissing(
    connectionId: string,
    keepGoogleIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.crmGoogleReview.deleteMany({
        where: { connectionId, googleReviewId: { notIn: keepGoogleIds } },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to prune Google reviews', error))
    }
  },

  async setReply(
    id: string,
    reply: { comment: string; updatedAt: Date } | null,
  ): Promise<Result<CrmGoogleReview>> {
    try {
      return ok(
        await prisma.crmGoogleReview.update({
          where: { id },
          data: {
            replyComment: reply?.comment ?? null,
            replyUpdatedAt: reply?.updatedAt ?? null,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save Google review reply', error))
    }
  },

  async markAlerted(ids: string[]): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmGoogleReview.updateMany({
        where: { id: { in: ids } },
        data: { alertedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark Google reviews as alerted', error))
    }
  },
}

export const CrmGoogleMetricRepository = {
  async upsertMany(
    connectionId: string,
    rows: DailyMetricRow[],
  ): Promise<Result<void>> {
    if (rows.length === 0) return ok(undefined)
    try {
      await prisma.$transaction(
        rows.map(({ date, ...values }) => {
          const day = new Date(`${date}T00:00:00.000Z`)
          return prisma.crmGoogleBusinessDailyMetric.upsert({
            where: { connectionId_date: { connectionId, date: day } },
            create: { connectionId, date: day, ...values },
            update: values,
          })
        }),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to upsert Google daily metrics', error))
    }
  },

  async listSince(
    connectionId: string,
    from: Date,
  ): Promise<Result<CrmGoogleBusinessDailyMetric[]>> {
    try {
      return ok(
        await prisma.crmGoogleBusinessDailyMetric.findMany({
          where: { connectionId, date: { gte: from } },
          orderBy: { date: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list Google daily metrics', error))
    }
  },
}
