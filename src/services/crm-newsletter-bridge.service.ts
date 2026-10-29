import { logger } from '@/lib/axiom/logger'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import {
  type BridgeIssue,
  type BridgeSubscriber,
  CrmNewsletterBridgeRepository,
} from '@/src/repositories/crm-newsletter-bridge.repository'
import type { CrmLeadEventRuleField } from '@/src/schemas/crm-lead.schema'
import type { CrmWorkflowNewsletterTriggerType } from '@/src/schemas/crm-workflow.schema'
import { CrmLeadScoringRuleService } from './crm-lead-scoring-rule.service'
import { dispatchCrmWorkflowNewsletterEvent } from './crm-workflow-dispatcher'

/**
 * Newsletter ↔ CRM bridge (ADR 0054 phase 2). The subscriber and tracking
 * services emit what happened; the bridge turns it into a CRM timeline
 * entry on the person, engagement points on their leads and newsletter
 * workflow runs. It never fails the caller: tracking and subscribing must
 * work even if the CRM side is down, so errors are only logged.
 */
export type NewsletterBridgeEvent =
  /** Subscribe request (public page, form, preferences, member). The
   * subscriber row already holds the outcome: PENDING or ACTIVE. */
  | { type: 'subscribed'; subscriberId: string }
  /** Double opt-in confirmed (PENDING → ACTIVE). */
  | { type: 'confirmed'; subscriberId: string }
  | { type: 'unsubscribed'; subscriberId: string }
  /** First `delivered` webhook of the recipient. */
  | { type: 'issue_received'; subscriberId: string; issueId: string }
  /** First open of the recipient (a click implies one). */
  | { type: 'issue_opened'; subscriberId: string; issueId: string }
  /** A click, already stored in `crm_newsletter_link_clicks`. */
  | {
      type: 'link_clicked'
      subscriberId: string
      issueId: string
      recipientId: string
      url: string | null
    }
  /** First read receipt of the issue's WhatsApp message (nl3). Timeline
   * only: no scoring and no workflow trigger. */
  | { type: 'issue_whatsapp_read'; subscriberId: string; issueId: string }

/** Timeline actions of the bridge (`CrmActivity.action`). */
export const NEWSLETTER_ACTIVITY_ACTIONS = {
  subscribed: 'NEWSLETTER_SUBSCRIBED',
  confirmed: 'NEWSLETTER_CONFIRMED',
  unsubscribed: 'NEWSLETTER_UNSUBSCRIBED',
  issue_received: 'NEWSLETTER_ISSUE_RECEIVED',
  issue_opened: 'NEWSLETTER_ISSUE_OPENED',
  link_clicked: 'NEWSLETTER_LINK_CLICKED',
  issue_whatsapp_read: 'NEWSLETTER_WHATSAPP_READ',
} as const satisfies Record<NewsletterBridgeEvent['type'], string>

/** `CrmActivity.entity` of the bridge entries. */
export const NEWSLETTER_ACTIVITY_ENTITY = {
  newsletter: 'newsletter',
  issue: 'newsletter_issue',
} as const

type Step = 'load' | 'timeline' | 'scoring' | 'workflows'

function issueLabel(issue: BridgeIssue): string {
  const number = issue.number ? `nº ${issue.number} ` : ''
  return `a edição ${number}"${issue.subject}"`
}

function summaryOf(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
  issue: BridgeIssue | null,
): string {
  const newsletter = `"${subscriber.newsletter.name}"`
  switch (event.type) {
    case 'subscribed':
      return subscriber.status === 'PENDING'
        ? `Pediu para assinar a newsletter ${newsletter} (aguardando confirmação)`
        : `Assinou a newsletter ${newsletter}`
    case 'confirmed':
      return `Confirmou a inscrição na newsletter ${newsletter}`
    case 'unsubscribed':
      return `Saiu da newsletter ${newsletter}`
    case 'issue_received':
      return `Recebeu ${issue ? issueLabel(issue) : 'uma edição'} da newsletter ${newsletter}`
    case 'issue_opened':
      return `Abriu ${issue ? issueLabel(issue) : 'uma edição'} da newsletter ${newsletter}`
    case 'link_clicked':
      return `Clicou em um link ${issue ? `d${issueLabel(issue)}` : 'de uma edição'} da newsletter ${newsletter}`
    case 'issue_whatsapp_read':
      return `Leu no WhatsApp ${issue ? issueLabel(issue) : 'uma edição'} da newsletter ${newsletter}`
  }
}

/** Issue events: one timeline entry per event type per issue. */
const ONCE_PER_ISSUE = new Set<NewsletterBridgeEvent['type']>([
  'issue_received',
  'issue_opened',
  'link_clicked',
  'issue_whatsapp_read',
])

function scoringOf(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
): {
  field: CrmLeadEventRuleField
  eventKey: string
  url?: string | null
} | null {
  switch (event.type) {
    case 'subscribed':
    case 'confirmed':
      return subscriber.status === 'ACTIVE'
        ? {
            field: 'newsletter_subscribed',
            eventKey: `newsletter:${subscriber.newsletterId}`,
          }
        : null
    case 'issue_opened':
      return { field: 'newsletter_opened', eventKey: `issue:${event.issueId}` }
    case 'link_clicked':
      return {
        field: 'newsletter_clicked',
        eventKey: `issue:${event.issueId}`,
        url: event.url,
      }
    default:
      return null
  }
}

/**
 * The workflow trigger of an event. Link clicks fire once per recipient ×
 * URL (the stored click being the first one), so a reader clicking the same
 * link twice does not run the workflow twice.
 */
async function triggerOf(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
): Promise<CrmWorkflowNewsletterTriggerType | null> {
  switch (event.type) {
    case 'subscribed':
    case 'confirmed':
      return subscriber.status === 'ACTIVE' ? 'newsletter-subscribed' : null
    case 'unsubscribed':
      return 'newsletter-unsubscribed'
    case 'issue_opened':
      return 'newsletter-issue-opened'
    case 'link_clicked': {
      if (!event.url) return 'newsletter-link-clicked'
      const clicks = await CrmNewsletterBridgeRepository.countClicks(
        event.recipientId,
        event.url,
      )
      if (!clicks.ok) throw clicks.error
      return clicks.value <= 1 ? 'newsletter-link-clicked' : null
    }
    default:
      return null
  }
}

function logFailure(
  step: Step,
  event: NewsletterBridgeEvent,
  error: unknown,
): void {
  logger.warn('crm.newsletter.bridge_failed', {
    component: 'CrmNewsletterBridge',
    step,
    event: event.type,
    subscriberId: event.subscriberId,
    error:
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : error instanceof Error
          ? error.message
          : String(error),
  })
}

async function resolvePersonId(
  subscriber: BridgeSubscriber,
): Promise<string | null> {
  if (subscriber.personId) return subscriber.personId
  const found = await CrmNewsletterBridgeRepository.findPersonIdByEmail(
    subscriber.workspaceId,
    subscriber.email,
  )
  if (!found.ok) throw found.error
  return found.value
}

async function recordTimeline(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
  personId: string,
  issue: BridgeIssue | null,
): Promise<void> {
  const action = NEWSLETTER_ACTIVITY_ACTIONS[event.type]
  const isIssueEvent = 'issueId' in event
  const entityId = isIssueEvent ? event.issueId : subscriber.newsletterId

  if (ONCE_PER_ISSUE.has(event.type)) {
    const seen = await CrmNewsletterBridgeRepository.hasActivity({
      workspaceId: subscriber.workspaceId,
      personId,
      action,
      entityId,
    })
    if (!seen.ok) throw seen.error
    if (seen.value) return
  }

  const recorded = await CrmActivityRepository.record({
    workspaceId: subscriber.workspaceId,
    action,
    entity: isIssueEvent
      ? NEWSLETTER_ACTIVITY_ENTITY.issue
      : NEWSLETTER_ACTIVITY_ENTITY.newsletter,
    entityId,
    personId,
    summary: summaryOf(event, subscriber, issue),
  })
  if (!recorded.ok) throw recorded.error
}

async function applyScoring(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
  personId: string | null,
): Promise<void> {
  const scoring = scoringOf(event, subscriber)
  if (!scoring) return
  const result = await CrmLeadScoringRuleService.applyEngagementEvent({
    workspaceId: subscriber.workspaceId,
    personId,
    email: subscriber.email,
    ...scoring,
  })
  if (!result.ok) throw result.error
}

async function dispatchWorkflows(
  event: NewsletterBridgeEvent,
  subscriber: BridgeSubscriber,
  personId: string | null,
  issue: BridgeIssue | null,
): Promise<void> {
  const type = await triggerOf(event, subscriber)
  if (!type) return
  await dispatchCrmWorkflowNewsletterEvent({
    workspaceId: subscriber.workspaceId,
    type,
    payload: {
      newsletter: subscriber.newsletter,
      record: {
        id: subscriber.id,
        email: subscriber.email,
        name: subscriber.name,
        status: subscriber.status,
        personId,
      },
      ...(issue ? { issue } : {}),
      ...(event.type === 'link_clicked' && event.url ? { url: event.url } : {}),
    },
  })
}

/** Runs one step; a failure is logged and the next step still runs. */
async function step(
  name: Step,
  event: NewsletterBridgeEvent,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    logFailure(name, event, error)
  }
}

export const CrmNewsletterBridge = {
  /** Never throws and never returns an error. */
  async emit(event: NewsletterBridgeEvent): Promise<void> {
    try {
      const found = await CrmNewsletterBridgeRepository.findSubscriber(
        event.subscriberId,
      )
      if (!found.ok) throw found.error
      const subscriber = found.value
      if (!subscriber) return

      let issue: BridgeIssue | null = null
      if ('issueId' in event) {
        const loaded = await CrmNewsletterBridgeRepository.findIssue(
          event.issueId,
        )
        if (!loaded.ok) throw loaded.error
        issue = loaded.value
      }

      const personId = await resolvePersonId(subscriber)

      if (personId) {
        await step('timeline', event, () =>
          recordTimeline(event, subscriber, personId, issue),
        )
      }
      await step('scoring', event, () =>
        applyScoring(event, subscriber, personId),
      )
      await step('workflows', event, () =>
        dispatchWorkflows(event, subscriber, personId, issue),
      )
    } catch (error) {
      logFailure('load', event, error)
    }
  },

  /** Several subscribers at once (preference center). */
  async emitMany(
    type: 'subscribed' | 'unsubscribed',
    subscriberIds: string[],
  ): Promise<void> {
    for (const subscriberId of subscriberIds) {
      await CrmNewsletterBridge.emit({ type, subscriberId })
    }
  },
}
