import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import {
  AI_DIGEST_HOUR,
  AI_DIGEST_MAX_ITEMS,
  AI_DIGEST_SYSTEM_PROMPT,
  type AiDigestItem,
  cleanDigestIntro,
  digestPromptInput,
  fallbackDigestIntro,
  isDigestIntroGrounded,
  sortDigestItems,
} from '@/src/lib/ai/proactive/digest'
import { dayKeyIn, hourIn, safeTimeZone } from '@/src/lib/ai/proactive/format'
import {
  AI_INSIGHT_MODULE_LABELS,
  AI_INSIGHT_SEVERITY_LABELS,
} from '@/src/lib/ai/proactive/labels'
import { sendAiDailyDigestEmail } from '@/src/lib/mail/steel-ai/send-ai-daily-digest'
import { AiDigestSettingRepository } from '@/src/repositories/ai-digest-setting.repository'
import {
  AiProactiveSignalRepository,
  type ProactiveMemberRow,
  type ProactiveWorkspaceRow,
} from '@/src/repositories/ai-proactive-signal.repository'
import type { AiInsightDTO } from '@/types/ai-insight'
import { AiInsightService } from './ai-insight.service'
import { AiUsageService } from './ai-usage.service'
import { NotificationService } from './notification.service'

/**
 * Daily digest of the proactive AI (ADR 0040), `ai-proactive` hourly tick.
 * Each person gets it once a local day, from `AI_DIGEST_HOUR` in their own
 * time zone (a short window, so a tick missed at 08:00 still sends at
 * 09:00), with their active insights — already filtered by permission by
 * `AiInsightService.list`, read as that person. **A day with no insight
 * sends nothing.** The LLM only phrases the intro and is overruled by the
 * deterministic sentence whenever it cites a number the data did not
 * produce. Never throws.
 */

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'
/** Hours after `AI_DIGEST_HOUR` a late tick may still send the day's digest. */
const SEND_WINDOW_HOURS = 3
const INTRO_MAX_TOKENS = 200

export interface AiDigestTickResult {
  workspaces: number
  /** People at the digest hour who had not received today's yet. */
  due: number
  sent: number
  inApp: number
  email: number
  /** Due, but no active insight: nothing sent (skip empty days). */
  empty: number
  /** Intros written by the LLM and kept (grounded). */
  phrased: number
  /** LLM intros thrown away for citing a number not in the data. */
  rejected: number
  errors: number
}

function emptyResult(): AiDigestTickResult {
  return {
    workspaces: 0,
    due: 0,
    sent: 0,
    inApp: 0,
    email: 0,
    empty: 0,
    phrased: 0,
    rejected: 0,
    errors: 0,
  }
}

/** Local hour inside the digest window. */
export function isDigestHour(hour: number): boolean {
  return hour >= AI_DIGEST_HOUR && hour < AI_DIGEST_HOUR + SEND_WINDOW_HOURS
}

function toDigestItem(insight: AiInsightDTO): AiDigestItem {
  return {
    module: insight.module,
    severity: insight.severity,
    title: insight.title,
    body: insight.body,
    facts: insight.facts,
    href: insight.href,
  }
}

/**
 * The intro: the LLM's sentence when it is grounded in the items, else the
 * deterministic one. `source` tells which one was used.
 */
export async function phraseDigestIntro(
  workspaceId: string,
  userId: string,
  items: AiDigestItem[],
): Promise<{ intro: string; source: 'llm' | 'fallback' | 'rejected' }> {
  const fallback = fallbackDigestIntro(items)
  const call = await AiUsageService.prepare(
    workspaceId,
    'PROACTIVE_DIGEST',
    userId,
  )
  // No provider, quota exhausted: the digest still goes, unphrased.
  if (!call.ok) return { intro: fallback, source: 'fallback' }

  let text: string
  try {
    const response = await call.value.provider.chat({
      model: call.value.model.model,
      system: AI_DIGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: digestPromptInput(items) }],
      maxTokens: INTRO_MAX_TOKENS,
    })
    await AiUsageService.record(call.value, {
      workspaceId,
      userId,
      usage: response.usage,
    })
    text = cleanDigestIntro(response.text)
  } catch (error) {
    logger.warn(
      'ai.proactive.digest_intro_failed',
      logFields(
        {
          component: 'AiDigestService',
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        },
        { model: call.value.model.key },
      ),
    )
    return { intro: fallback, source: 'fallback' }
  }

  if (!text) return { intro: fallback, source: 'fallback' }
  if (!isDigestIntroGrounded(text, items)) {
    logger.warn(
      'ai.proactive.digest_intro_rejected',
      logFields(
        { component: 'AiDigestService', workspaceId },
        { model: call.value.model.key, items: items.length },
      ),
    )
    return { intro: fallback, source: 'rejected' }
  }
  return { intro: text, source: 'llm' }
}

async function digestFor(
  workspace: ProactiveWorkspaceRow,
  member: ProactiveMemberRow,
  channels: { inApp: boolean; email: boolean },
  day: string,
  now: Date,
  result: AiDigestTickResult,
): Promise<void> {
  const feed = await AiInsightService.list(
    member.userId,
    workspace.id,
    { state: 'active', limit: AI_DIGEST_MAX_ITEMS },
    now,
  )
  if (!feed.ok) {
    result.errors += 1
    return
  }
  if (!feed.value.enabled || feed.value.items.length === 0) {
    result.empty += 1
    return
  }

  const insights = sortDigestItems(feed.value.items)
  const items = insights.map(toDigestItem)
  const phrased = await phraseDigestIntro(workspace.id, member.userId, items)
  if (phrased.source === 'llm') result.phrased += 1
  if (phrased.source === 'rejected') result.rejected += 1

  const feedPath = `/${workspace.slug}/inbox?view=insights`
  let delivered = false

  if (channels.inApp) {
    const created = await NotificationService.notifyUsers({
      workspaceId: workspace.id,
      userIds: [member.userId],
      kind: 'AI_DAILY_DIGEST',
      title: 'Resumo diário da IA',
      body: phrased.intro,
      href: feedPath,
      // One per local day, even if a retry or a second tick runs.
      dedupeKey: `ai-digest:${day}`,
    })
    if (created.ok) {
      result.inApp += created.value
      delivered = true
    } else {
      result.errors += 1
    }
  }

  if (channels.email) {
    try {
      await sendAiDailyDigestEmail({
        email: member.email,
        username: member.name.trim().split(/\s+/)[0] || undefined,
        workspaceName: workspace.name,
        intro: phrased.intro,
        items: insights.map((insight) => ({
          moduleLabel: AI_INSIGHT_MODULE_LABELS[insight.module],
          severityLabel: AI_INSIGHT_SEVERITY_LABELS[insight.severity],
          title: insight.title,
          body: insight.body,
          url: insight.href ? `${NEXT_PUBLIC_URL}${insight.href}` : null,
        })),
        feedUrl: `${NEXT_PUBLIC_URL}${feedPath}`,
        settingsUrl: `${NEXT_PUBLIC_URL}/${workspace.slug}/settings/notifications`,
      })
      result.email += 1
      delivered = true
    } catch (error) {
      result.errors += 1
      logger.warn(
        'ai.proactive.digest_email_failed',
        logFields(
          {
            component: 'AiDigestService',
            workspaceId: workspace.id,
            message: error instanceof Error ? error.message : String(error),
          },
          {},
        ),
      )
    }
  }

  if (!delivered) return
  result.sent += 1
  const marked = await AiDigestSettingRepository.markSent(
    workspace.id,
    member.userId,
    day,
  )
  if (!marked.ok) result.errors += 1
}

async function runWorkspace(
  workspace: ProactiveWorkspaceRow,
  now: Date,
  result: AiDigestTickResult,
): Promise<void> {
  const [members, settings] = await Promise.all([
    AiProactiveSignalRepository.listMembers(workspace.id),
    AiDigestSettingRepository.listByWorkspace(workspace.id),
  ])
  if (!members.ok || !settings.ok) {
    result.errors += 1
    return
  }
  const byUser = new Map(settings.value.map((row) => [row.userId, row]))

  for (const member of members.value) {
    const setting = byUser.get(member.userId)
    const channels = {
      inApp: setting?.inApp ?? true,
      email: setting?.email ?? true,
    }
    if (!channels.inApp && !channels.email) continue

    const zone = safeTimeZone(member.timeZone, DEFAULT_TIME_ZONE)
    if (!isDigestHour(hourIn(now, zone))) continue
    const day = dayKeyIn(now, zone)
    if (setting?.lastSentOn === day) continue

    result.due += 1
    await digestFor(workspace, member, channels, day, now, result)
  }
}

export const AiDigestService = {
  async runTick(now: Date = new Date()): Promise<AiDigestTickResult> {
    const result = emptyResult()
    const workspaces = await AiProactiveSignalRepository.listWorkspaces()
    if (!workspaces.ok) {
      result.errors += 1
      return result
    }

    for (const workspace of workspaces.value) {
      if (!workspace.aiEnabled || !workspace.proactiveEnabled) continue
      result.workspaces += 1
      try {
        await runWorkspace(workspace, now, result)
      } catch (error) {
        result.errors += 1
        logger.error(
          'ai.proactive.digest_workspace_failed',
          logFields(
            {
              component: 'AiDigestService',
              workspaceId: workspace.id,
              message: error instanceof Error ? error.message : String(error),
            },
            {},
          ),
        )
      }
    }

    logger.info('ai.proactive.digest_tick', { ...result })
    return result
  },
}
