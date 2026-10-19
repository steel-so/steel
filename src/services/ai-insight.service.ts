import { auditMutation } from '@/lib/axiom/audit'
import { aiInsightNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toAiDigestSettingsDTO,
  toAiInsightDTO,
} from '@/src/mappers/ai-insight.mapper'
import { AiDigestSettingRepository } from '@/src/repositories/ai-digest-setting.repository'
import { AiInsightRepository } from '@/src/repositories/ai-insight.repository'
import type {
  ListAiInsightsQueryDTO,
  UpdateAiDigestSettingsDTO,
  UpdateAiInsightDTO,
} from '@/src/schemas/ai-insight.schema'
import type {
  AiDigestSettingsDTO,
  AiInsightDTO,
  AiInsightFeedDTO,
} from '@/types/ai-insight'
import {
  type AiInsightModule,
  isProactiveEnabled,
  resolveAiInsightAccess,
} from './ai-insight-access'
import { assertMember } from './authz'

const HOUR_MS = 3_600_000

const EMPTY_COUNTS = { active: 0, snoozed: 0, dismissed: 0 }

/**
 * The proactive AI as the user sees it (ADR 0040): their own insights feed
 * (home, Steel AI, inbox, `ws_insights`), dismiss/snooze, and the daily
 * digest channels. Every read re-checks the module gate; insights are
 * private to their user (someone else's id answers 404).
 */
export const AiInsightService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListAiInsightsQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<AiInsightFeedDTO>> {
    const access = await resolveAiInsightAccess(actorId, workspaceId)
    if (!access.ok) return access
    if (!access.value.enabled) {
      return ok({ enabled: false, items: [], counts: { ...EMPTY_COUNTS } })
    }

    const modules: AiInsightModule[] = query.module
      ? access.value.modules.filter((module) => module === query.module)
      : access.value.modules

    const [rows, counts] = await Promise.all([
      AiInsightRepository.listForUser(workspaceId, actorId, {
        state: query.state,
        modules,
        now,
        limit: query.limit,
      }),
      AiInsightRepository.countsForUser(workspaceId, actorId, modules, now),
    ])
    if (!rows.ok) return rows
    if (!counts.ok) return counts

    return ok({
      enabled: true,
      items: rows.value.map((row) => toAiInsightDTO(row, now)),
      counts: counts.value,
    })
  },

  /** Dismiss, snooze or restore one of the actor's insights. */
  async act(
    actorId: string,
    workspaceId: string,
    insightId: string,
    dto: UpdateAiInsightDTO,
    now: Date = new Date(),
  ): Promise<Result<AiInsightDTO>> {
    const access = await resolveAiInsightAccess(actorId, workspaceId)
    if (!access.ok) return access

    const row = await AiInsightRepository.findForUser(
      insightId,
      workspaceId,
      actorId,
    )
    if (!row.ok) return row
    if (
      !row.value ||
      !access.value.modules.includes(row.value.module as AiInsightModule)
    ) {
      return err(aiInsightNotFound())
    }

    const data =
      dto.action === 'dismiss'
        ? { dismissedAt: now, snoozedUntil: null }
        : dto.action === 'snooze'
          ? {
              dismissedAt: null,
              snoozedUntil: new Date(now.getTime() + dto.hours * HOUR_MS),
            }
          : { dismissedAt: null, snoozedUntil: null }

    const updated = await AiInsightRepository.updateState(row.value.id, data)
    if (!updated.ok) {
      auditMutation({
        entity: 'ai_insight',
        action: 'update',
        actorId,
        targetId: row.value.id,
        outcome: 'failure',
        reason: updated.error.code,
        meta: { workspaceId, action: dto.action },
      })
      return updated
    }

    auditMutation({
      entity: 'ai_insight',
      action: 'update',
      actorId,
      targetId: row.value.id,
      meta: {
        workspaceId,
        action: dto.action,
        kind: row.value.kind,
        ...(dto.action === 'snooze' && { hours: dto.hours }),
      },
    })
    return ok(toAiInsightDTO(updated.value, now))
  },

  async getDigestSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiDigestSettingsDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const [row, enabled] = await Promise.all([
      AiDigestSettingRepository.find(workspaceId, actorId),
      isProactiveEnabled(workspaceId),
    ])
    if (!row.ok) return row
    if (!enabled.ok) return enabled
    return ok(toAiDigestSettingsDTO(row.value, enabled.value))
  },

  async updateDigestSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateAiDigestSettingsDTO,
  ): Promise<Result<AiDigestSettingsDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const saved = await AiDigestSettingRepository.upsert(workspaceId, actorId, {
      ...(dto.inApp !== undefined && { inApp: dto.inApp }),
      ...(dto.email !== undefined && { email: dto.email }),
    })
    if (!saved.ok) {
      auditMutation({
        entity: 'ai_digest_setting',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: saved.error.code,
        meta: { workspaceId },
      })
      return saved
    }

    auditMutation({
      entity: 'ai_digest_setting',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, inApp: saved.value.inApp, email: saved.value.email },
    })

    const enabled = await isProactiveEnabled(workspaceId)
    if (!enabled.ok) return enabled
    return ok(toAiDigestSettingsDTO(saved.value, enabled.value))
  },
}
