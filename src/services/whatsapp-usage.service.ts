import type { WhatsAppSettings } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappConversationLimitReached,
  whatsappMessageLimitReached,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  crossedUsageThreshold,
  whatsappUsagePeriod,
} from '@/src/lib/whatsapp/usage-period'
import { toWhatsAppUsageDTO } from '@/src/mappers/whatsapp-usage.mapper'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppUsageRepository } from '@/src/repositories/whatsapp-usage.repository'
import type {
  UpdateWhatsAppUsageLimitsDTO,
  WhatsAppUsageMetric,
} from '@/src/schemas/whatsapp-usage.schema'
import type { WhatsAppUsageDTO } from '@/types/whatsapp-usage'
import { assertMember, assertPrivileged } from './authz'
import { notifyWhatsAppUsage } from './platform-notifications'

const LIMIT_REACHED = {
  conversations: whatsappConversationLimitReached,
  messages: whatsappMessageLimitReached,
} as const

async function loadUsage(
  workspaceId: string,
  canManage: boolean,
  /** Row just saved — skips re-reading the settings. */
  saved?: WhatsAppSettings,
): Promise<Result<WhatsAppUsageDTO>> {
  const period = whatsappUsagePeriod()
  const [settings, usage] = await Promise.all([
    saved
      ? Promise.resolve(ok(saved))
      : WhatsAppSettingsRepository.findByWorkspace(workspaceId),
    WhatsAppUsageRepository.find(workspaceId, period),
  ])
  if (!settings.ok) return settings
  if (!usage.ok) return usage
  return ok(
    toWhatsAppUsageDTO({
      workspaceId,
      period,
      usage: usage.value,
      settings: settings.value,
      canManage,
    }),
  )
}

/**
 * Monthly limits of the Comunicação module (conversations opened and
 * outbound messages). `assertCanSend` runs before a send / agent-started
 * conversation and `record` after it; inbound is recorded but never blocked.
 * Check-then-send is not atomic: concurrent sends at the edge may overshoot
 * the limit by a few units, which is acceptable for a budget.
 */
export const WhatsAppUsageService = {
  /** Current month usage — any member (they all receive the alerts). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppUsageDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    return loadUsage(workspaceId, membership.value.isPrivileged)
  },

  /** OWNER/ADMIN. Omitted fields keep their value; `null` = unlimited. */
  async updateLimits(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppUsageLimitsDTO,
  ): Promise<Result<WhatsAppUsageDTO>> {
    const privileged = await assertPrivileged(actorId, workspaceId)
    if (!privileged.ok) return privileged

    const data: UpdateWhatsAppUsageLimitsDTO = {}
    if (dto.monthlyConversationLimit !== undefined) {
      data.monthlyConversationLimit = dto.monthlyConversationLimit
    }
    if (dto.monthlyMessageLimit !== undefined) {
      data.monthlyMessageLimit = dto.monthlyMessageLimit
    }

    const saved = await WhatsAppSettingsRepository.upsert(workspaceId, data)
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_usage_limits',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        monthlyConversationLimit: saved.value.monthlyConversationLimit,
        monthlyMessageLimit: saved.value.monthlyMessageLimit,
      },
    })

    return loadUsage(workspaceId, true, saved.value)
  },

  /**
   * System check before a metered action. Fails **open** on a lookup error
   * (logged): a database hiccup must not silence customer service.
   */
  async assertCanSend(
    workspaceId: string,
    metric: WhatsAppUsageMetric,
  ): Promise<Result<void>> {
    const [settings, usage] = await Promise.all([
      WhatsAppSettingsRepository.findByWorkspace(workspaceId),
      WhatsAppUsageRepository.find(workspaceId, whatsappUsagePeriod()),
    ])
    if (!settings.ok || !usage.ok) {
      logger.warn(
        'whatsapp.usage.check_failed',
        logFields(
          { component: 'WhatsAppUsageService', workspaceId },
          { metric },
        ),
      )
      return ok(undefined)
    }

    const limit =
      metric === 'conversations'
        ? settings.value?.monthlyConversationLimit
        : settings.value?.monthlyMessageLimit
    if (limit === null || limit === undefined) return ok(undefined)

    const used =
      metric === 'conversations'
        ? (usage.value?.conversations ?? 0)
        : (usage.value?.outboundMessages ?? 0)
    if (used < limit) return ok(undefined)

    logger.info(
      'whatsapp.usage.limit_blocked',
      logFields(
        { component: 'WhatsAppUsageService', workspaceId },
        { metric, used, limit },
      ),
    )
    return err(LIMIT_REACHED[metric](used, limit))
  },

  /**
   * Counts one unit and alerts every member when 50/80/100% is crossed.
   * Never fails the caller: the send already happened.
   */
  async record(
    workspaceId: string,
    metric: WhatsAppUsageMetric,
  ): Promise<void> {
    try {
      const period = whatsappUsagePeriod()
      const row = await WhatsAppUsageRepository.increment(
        workspaceId,
        period,
        metric,
      )
      if (!row.ok) {
        logger.warn(
          'whatsapp.usage.record_failed',
          logFields(
            { component: 'WhatsAppUsageService', workspaceId },
            { metric, reason: row.error.code },
          ),
        )
        return
      }

      const settings =
        await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
      if (!settings.ok) return
      const limit =
        (metric === 'conversations'
          ? settings.value?.monthlyConversationLimit
          : settings.value?.monthlyMessageLimit) ?? null
      const used =
        metric === 'conversations'
          ? row.value.conversations
          : row.value.outboundMessages

      const threshold = crossedUsageThreshold(used - 1, used, limit)
      if (!threshold || limit === null) return

      logger.info(
        'whatsapp.usage.threshold_crossed',
        logFields(
          { component: 'WhatsAppUsageService', workspaceId },
          { metric, threshold, used, limit },
        ),
      )
      await notifyWhatsAppUsage({
        workspaceId,
        metric,
        threshold,
        period,
        used,
        limit,
      })
    } catch (error) {
      logger.warn(
        'whatsapp.usage.record_failed',
        logFields(
          { component: 'WhatsAppUsageService', workspaceId },
          {
            metric,
            reason: error instanceof Error ? error.message : String(error),
          },
        ),
      )
    }
  },
}
