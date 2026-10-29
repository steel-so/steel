import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeBridgeSubscriber } from '@/src/__tests__/factories/newsletter2-crm-bridge.factory'
import { ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger')
vi.mock('@/src/repositories/crm-newsletter-bridge.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/services/crm-lead-scoring-rule.service')
vi.mock('@/src/services/crm-workflow-dispatcher')

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

const event = {
  type: 'issue_whatsapp_read',
  subscriberId: 's1',
  issueId: 'is1',
} as const

beforeEach(() => {
  vi.clearAllMocks()
  repo.findSubscriber.mockResolvedValue(
    ok(createFakeBridgeSubscriber({ id: 's1' })),
  )
  repo.findIssue.mockResolvedValue(
    ok({ id: 'is1', subject: 'Outubro', number: 3 }),
  )
  repo.hasActivity.mockResolvedValue(ok(false))
  activities.record.mockResolvedValue(ok({} as never))
})

describe('CrmNewsletterBridge.emit — read on WhatsApp (nl3)', () => {
  it('logs one timeline entry per issue, without points or workflows', async () => {
    expect(NEWSLETTER_ACTIVITY_ACTIONS.issue_whatsapp_read).toBe(
      'NEWSLETTER_WHATSAPP_READ',
    )
    await CrmNewsletterBridge.emit(event)
    expect(repo.hasActivity).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      personId: 'p1',
      action: 'NEWSLETTER_WHATSAPP_READ',
      entityId: 'is1',
    })
    expect(activities.record).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      action: 'NEWSLETTER_WHATSAPP_READ',
      entity: 'newsletter_issue',
      entityId: 'is1',
      personId: 'p1',
      summary:
        'Leu no WhatsApp a edição nº 3 "Outubro" da newsletter "Novidades"',
    })
    expect(scoring.applyEngagementEvent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()

    vi.clearAllMocks()
    repo.hasActivity.mockResolvedValue(ok(true))
    await CrmNewsletterBridge.emit(event)
    expect(activities.record).not.toHaveBeenCalled()
  })

  it('falls back to a generic label when the issue is gone', async () => {
    repo.findIssue.mockResolvedValue(ok(null))
    await CrmNewsletterBridge.emit(event)
    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Leu no WhatsApp uma edição da newsletter "Novidades"',
      }),
    )
  })
})
