import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import {
  toWaAiCampaignActionRows,
  toWaBroadcastRecipientRows,
  toWaCostRows,
  toWaMessageRows,
  toWaTemplateRows,
} from '@/src/mappers/whatsapp-dashboard-messaging.mapper'
import { toWaAiCampaignRecipientRows } from '@/src/mappers/whatsapp-dashboard-source.mapper'
import { WhatsAppDashboardMessagingRepository } from '@/src/repositories/whatsapp-dashboard-messaging.repository'
import { WhatsAppDashboardSourceRepository } from '@/src/repositories/whatsapp-dashboard-source.repository'
import {
  WA_DASHBOARD_HISTORY_DAYS,
  WA_DASHBOARD_ROW_LIMITS,
  type WaDashboardSource,
} from '@/src/schemas/whatsapp-dashboard.schema'
import type { WaDashboardRow } from '@/types/whatsapp-dashboard'
import { assertModuleMember } from './authz'

const DAY_MS = 86_400_000

type Loader = (
  workspaceId: string,
  since: Date,
  limit: number,
) => Promise<Result<WaDashboardRow[]>>

/** One loader per source: a new source only adds its entry here. */
const LOADERS: Record<WaDashboardSource, Loader> = {
  'whatsapp-ai-campaign-recipients': async (workspaceId, since, limit) => {
    const data =
      await WhatsAppDashboardSourceRepository.aiCampaignRecipientData(
        workspaceId,
        since,
        limit,
      )
    if (!data.ok) return data
    return ok(toWaAiCampaignRecipientRows(data.value))
  },
  'whatsapp-messages': async (workspaceId, since, limit) => {
    const messages = await WhatsAppDashboardMessagingRepository.messages(
      workspaceId,
      since,
      limit,
    )
    if (!messages.ok) return messages
    return ok(toWaMessageRows(messages.value))
  },
  'whatsapp-broadcast-recipients': async (workspaceId, since, limit) => {
    const data =
      await WhatsAppDashboardMessagingRepository.broadcastRecipientData(
        workspaceId,
        since,
        limit,
      )
    if (!data.ok) return data
    return ok(toWaBroadcastRecipientRows(data.value))
  },
  // Current state of the templates: the history window does not apply.
  'whatsapp-templates': async (workspaceId, _since, limit) => {
    const templates = await WhatsAppDashboardMessagingRepository.templates(
      workspaceId,
      limit,
    )
    if (!templates.ok) return templates
    return ok(toWaTemplateRows(templates.value))
  },
  'whatsapp-costs': async (workspaceId, since, limit) => {
    const data = await WhatsAppDashboardMessagingRepository.costData(
      workspaceId,
      since,
      limit,
    )
    if (!data.ok) return data
    return ok(toWaCostRows(data.value))
  },
  'whatsapp-ai-campaign-actions': async (workspaceId, since, limit) => {
    const runs =
      await WhatsAppDashboardMessagingRepository.aiCampaignActionRuns(
        workspaceId,
        since,
        limit,
      )
    if (!runs.ok) return runs
    return ok(toWaAiCampaignActionRows(runs.value))
  },
}

/**
 * Data of the widgets of the Comunicação dashboards. Same gate as the
 * dashboards themselves (module enabled + `dashboards:VIEW`). The cut is
 * the history of `WA_DASHBOARD_HISTORY_DAYS` days with a row ceiling per
 * source.
 */
export const WhatsAppDashboardSourceService = {
  async rows(
    actorId: string,
    workspaceId: string,
    source: WaDashboardSource,
    now: Date = new Date(),
  ): Promise<Result<WaDashboardRow[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'dashboards', action: 'VIEW' },
    )
    if (!access.ok) return access

    const limit = WA_DASHBOARD_ROW_LIMITS[source]
    const since = new Date(now.getTime() - WA_DASHBOARD_HISTORY_DAYS * DAY_MS)
    const rows = await LOADERS[source](workspaceId, since, limit)
    if (!rows.ok) return rows
    if (rows.value.length >= limit) {
      logger.warn('whatsapp.dashboard.source_truncated', {
        workspaceId,
        source,
        limit,
      })
    }
    return rows
  },
}
