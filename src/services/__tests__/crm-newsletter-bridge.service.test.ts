import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeBridgeSubscriber } from '@/src/__tests__/factories/newsletter2-crm-bridge.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger')
vi.mock('@/src/repositories/crm-newsletter-bridge.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/services/crm-lead-scoring-rule.service')
vi.mock('@/src/services/crm-workflow-dispatcher')

import { logger } from '@/lib/axiom/logger'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmNewsletterBridgeRepository } from '@/src/repositories/crm-newsletter-bridge.repository'
import { CrmLeadScoringRuleService } from '../crm-lead-scoring-rule.service'
import {
  CrmNewsletterBridge,
  NEWSLETTER_ACTIVITY_ACTIONS,
} from '../crm-newsletter-bridge.service'
import { dispatchCrmWorkflowNewsletterEvent } from '../crm-workflow-dispatcher'

const repo = vi.mocked(CrmNewsletterBridgeRepository)
const activities = vi.mocked(CrmActivityRepository)
const scoring = vi.mocked(CrmLeadScoringRuleService)
const dispatch = vi.mocked(dispatchCrmWorkflowNewsletterEvent)
const warn = vi.mocked(logger.warn)

const issue = { id: 'is1', subject: 'Outubro', number: 3 }

function given(overrides: Parameters<typeof createFakeBridgeSubscriber>[0]) {
  repo.findSubscriber.mockResolvedValue(
    ok(createFakeBridgeSubscriber({ id: 's1', ...overrides })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  given({})
  repo.findIssue.mockResolvedValue(ok(issue))
  repo.findPersonIdByEmail.mockResolvedValue(ok(null))
  repo.hasActivity.mockResolvedValue(ok(false))
  repo.countClicks.mockResolvedValue(ok(1))
  activities.record.mockResolvedValue(ok({} as never))
  scoring.applyEngagementEvent.mockResolvedValue(ok(1))
  dispatch.mockResolvedValue(1)
})

describe('CrmNewsletterBridge.emit — subscriptions', () => {
  it('records an ACTIVE subscription, scores it and fires the workflows', async () => {
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })

    expect(activities.record).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      action: 'NEWSLETTER_SUBSCRIBED',
      entity: 'newsletter',
      entityId: 'nl1',
      personId: 'p1',
      summary: 'Assinou a newsletter "Novidades"',
    })
    // Subscriptions are not deduplicated (subscribe again = new entry).
    expect(repo.hasActivity).not.toHaveBeenCalled()
    expect(scoring.applyEngagementEvent).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      personId: 'p1',
      email: 'ana@empresa.com.br',
      field: 'newsletter_subscribed',
      eventKey: 'newsletter:nl1',
    })
    expect(dispatch).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      type: 'newsletter-subscribed',
      payload: {
        newsletter: { id: 'nl1', name: 'Novidades' },
        record: {
          id: 's1',
          email: 'ana@empresa.com.br',
          name: 'Ana',
          status: 'ACTIVE',
          personId: 'p1',
        },
      },
    })
  })

  it('only records a PENDING request (no points, no workflow)', async () => {
    given({ status: 'PENDING' })
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })

    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        summary:
          'Pediu para assinar a newsletter "Novidades" (aguardando confirmação)',
      }),
    )
    expect(scoring.applyEngagementEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('treats the confirmation as the subscription', async () => {
    await CrmNewsletterBridge.emit({ type: 'confirmed', subscriberId: 's1' })

    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NEWSLETTER_CONFIRMED',
        summary: 'Confirmou a inscrição na newsletter "Novidades"',
      }),
    )
    expect(scoring.applyEngagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'newsletter_subscribed' }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'newsletter-subscribed' }),
    )
  })

  it('records the unsubscribe and fires its workflows without scoring', async () => {
    given({ status: 'UNSUBSCRIBED' })
    await CrmNewsletterBridge.emit({ type: 'unsubscribed', subscriberId: 's1' })

    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NEWSLETTER_UNSUBSCRIBED',
        summary: 'Saiu da newsletter "Novidades"',
      }),
    )
    expect(scoring.applyEngagementEvent).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'newsletter-unsubscribed' }),
    )
  })

  it('finds the person by e-mail when the subscriber is not linked', async () => {
    given({ personId: null })
    repo.findPersonIdByEmail.mockResolvedValue(ok('p9'))
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })

    expect(repo.findPersonIdByEmail).toHaveBeenCalledWith(
      'ws1',
      'ana@empresa.com.br',
    )
    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p9' }),
    )
  })

  it('skips the timeline without a person but still scores and dispatches', async () => {
    given({ personId: null })
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })

    expect(activities.record).not.toHaveBeenCalled()
    expect(scoring.applyEngagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({ personId: null }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          record: expect.objectContaining({ personId: null }),
        }),
      }),
    )
  })

  it('does nothing for a subscriber that no longer exists', async () => {
    repo.findSubscriber.mockResolvedValue(ok(null))
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })
    expect(activities.record).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('emits each subscriber of a batch', async () => {
    await CrmNewsletterBridge.emitMany('unsubscribed', ['a', 'b'])
    expect(repo.findSubscriber.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })
})

describe('CrmNewsletterBridge.emit — issue events', () => {
  it('records the receipt once per issue, without points or workflows', async () => {
    await CrmNewsletterBridge.emit({
      type: 'issue_received',
      subscriberId: 's1',
      issueId: 'is1',
    })
    expect(repo.hasActivity).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      personId: 'p1',
      action: 'NEWSLETTER_ISSUE_RECEIVED',
      entityId: 'is1',
    })
    expect(activities.record).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      action: 'NEWSLETTER_ISSUE_RECEIVED',
      entity: 'newsletter_issue',
      entityId: 'is1',
      personId: 'p1',
      summary: 'Recebeu a edição nº 3 "Outubro" da newsletter "Novidades"',
    })
    expect(scoring.applyEngagementEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()

    vi.clearAllMocks()
    repo.hasActivity.mockResolvedValue(ok(true))
    await CrmNewsletterBridge.emit({
      type: 'issue_received',
      subscriberId: 's1',
      issueId: 'is1',
    })
    expect(activities.record).not.toHaveBeenCalled()
  })

  it('scores and dispatches the open with the issue in the payload', async () => {
    repo.findIssue.mockResolvedValue(
      ok({ id: 'is1', subject: 'Sem número', number: null }),
    )
    await CrmNewsletterBridge.emit({
      type: 'issue_opened',
      subscriberId: 's1',
      issueId: 'is1',
    })
    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Abriu a edição "Sem número" da newsletter "Novidades"',
      }),
    )
    expect(scoring.applyEngagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'newsletter_opened',
        eventKey: 'issue:is1',
      }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'newsletter-issue-opened',
        payload: expect.objectContaining({
          issue: { id: 'is1', subject: 'Sem número', number: null },
        }),
      }),
    )
  })

  it('falls back to a generic label when the issue is gone', async () => {
    repo.findIssue.mockResolvedValue(ok(null))
    for (const type of ['issue_received', 'issue_opened'] as const) {
      await CrmNewsletterBridge.emit({
        type,
        subscriberId: 's1',
        issueId: 'is1',
      })
    }
    await CrmNewsletterBridge.emit({
      type: 'link_clicked',
      subscriberId: 's1',
      issueId: 'is1',
      recipientId: 'r1',
      url: null,
    })
    expect(activities.record.mock.calls.map((c) => c[0].summary)).toEqual([
      'Recebeu uma edição da newsletter "Novidades"',
      'Abriu uma edição da newsletter "Novidades"',
      'Clicou em um link de uma edição da newsletter "Novidades"',
    ])
  })

  it('scores the click with its URL and fires once per recipient × URL', async () => {
    const click = {
      type: 'link_clicked' as const,
      subscriberId: 's1',
      issueId: 'is1',
      recipientId: 'r1',
      url: 'https://acme.com/precos',
    }
    await CrmNewsletterBridge.emit(click)
    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NEWSLETTER_ACTIVITY_ACTIONS.link_clicked,
        summary:
          'Clicou em um link da edição nº 3 "Outubro" da newsletter "Novidades"',
      }),
    )
    expect(scoring.applyEngagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'newsletter_clicked',
        eventKey: 'issue:is1',
        url: 'https://acme.com/precos',
      }),
    )
    expect(repo.countClicks).toHaveBeenCalledWith(
      'r1',
      'https://acme.com/precos',
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'newsletter-link-clicked',
        payload: expect.objectContaining({ url: 'https://acme.com/precos' }),
      }),
    )

    vi.clearAllMocks()
    repo.countClicks.mockResolvedValue(ok(2))
    repo.hasActivity.mockResolvedValue(ok(true))
    await CrmNewsletterBridge.emit(click)
    expect(activities.record).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('fires a click without URL (cannot tell repeats apart)', async () => {
    await CrmNewsletterBridge.emit({
      type: 'link_clicked',
      subscriberId: 's1',
      issueId: 'is1',
      recipientId: 'r1',
      url: null,
    })
    expect(repo.countClicks).not.toHaveBeenCalled()
    const payload = dispatch.mock.calls[0][0].payload
    expect(payload).not.toHaveProperty('url')
  })
})

describe('CrmNewsletterBridge.emit — never fails the caller', () => {
  it('logs a failed load and stops', async () => {
    repo.findSubscriber.mockResolvedValue(err(databaseError()))
    await expect(
      CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' }),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'crm.newsletter.bridge_failed',
      expect.objectContaining({ step: 'load', error: 'DATABASE_ERROR' }),
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('logs failed issue and person lookups', async () => {
    repo.findIssue.mockResolvedValueOnce(err(databaseError()))
    await CrmNewsletterBridge.emit({
      type: 'issue_opened',
      subscriberId: 's1',
      issueId: 'is1',
    })
    given({ personId: null })
    repo.findPersonIdByEmail.mockResolvedValueOnce(err(databaseError()))
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('keeps going after a failing step', async () => {
    activities.record.mockResolvedValueOnce(err(databaseError()))
    scoring.applyEngagementEvent.mockResolvedValueOnce(err(databaseError()))
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.map((c) => c[1]?.step)).toEqual([
      'timeline',
      'scoring',
    ])
  })

  it('logs failed dedupe and click lookups and thrown errors', async () => {
    repo.hasActivity.mockResolvedValueOnce(err(databaseError()))
    repo.countClicks.mockResolvedValueOnce(err(databaseError()))
    await CrmNewsletterBridge.emit({
      type: 'link_clicked',
      subscriberId: 's1',
      issueId: 'is1',
      recipientId: 'r1',
      url: 'https://a',
    })
    expect(warn.mock.calls.map((c) => c[1]?.step)).toEqual([
      'timeline',
      'workflows',
    ])

    warn.mockClear()
    dispatch.mockRejectedValueOnce(new Error('boom'))
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })
    dispatch.mockRejectedValueOnce('plain')
    await CrmNewsletterBridge.emit({ type: 'subscribed', subscriberId: 's1' })
    expect(warn.mock.calls.map((c) => c[1]?.error)).toEqual(['boom', 'plain'])
  })
})
