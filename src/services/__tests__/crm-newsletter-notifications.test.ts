import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
  workspaceAdminIds: vi.fn(async () => ['admin1']),
}))

import {
  notifyNewsletterIssueFinished,
  notifyNewsletterUsage,
} from '../crm-newsletter-notifications'
import { emitNotification } from '../notification-emitter'

const emit = vi.mocked(emitNotification)
const base = {
  workspaceId: 'ws1',
  newsletterId: 'nl1',
  issueId: 'is1',
  createdById: 'u1',
  subject: 'Outubro',
}

describe('crm-newsletter-notifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tells the creator how the issue went', async () => {
    await notifyNewsletterIssueFinished({
      ...base,
      status: 'SENT',
      sent: 1200,
      failed: 3,
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipients: ['u1'],
        kind: 'CRM_NEWSLETTER_ISSUE_FINISHED',
        title: 'Edição enviada: Outubro',
        body: expect.stringContaining('1.200 e-mails enviados, 3 com erro'),
        path: '/crm/newsletters/nl1/issues/is1/report',
        dedupeKey: 'crm-newsletter-issue:is1:finished',
      }),
    )
    await notifyNewsletterIssueFinished({
      ...base,
      status: 'SENT',
      sent: 2,
      failed: 0,
    })
    expect(emit.mock.lastCall?.[0].body).not.toContain('com erro')
    await notifyNewsletterIssueFinished({
      ...base,
      status: 'FAILED',
      sent: 0,
      failed: 2,
    })
    expect(emit.mock.lastCall?.[0].title).toContain('Falha no envio')
    await notifyNewsletterIssueFinished({
      ...base,
      status: 'CANCELED',
      sent: 0,
      failed: 0,
    })
    expect(emit.mock.lastCall?.[0].title).toContain('Envio interrompido')
  })

  it('warns the admins at each threshold, once per month', async () => {
    await notifyNewsletterUsage({
      workspaceId: 'ws1',
      month: '2026-10',
      threshold: 80,
      used: 2400,
      limit: 3000,
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipients: ['admin1'],
        kind: 'CRM_NEWSLETTER_USAGE_WARNING',
        title: 'Newsletter: 80% do limite mensal de e-mails',
        dedupeKey: 'crm-newsletter-usage:ws1:2026-10:80',
      }),
    )
    await notifyNewsletterUsage({
      workspaceId: 'ws1',
      month: '2026-10',
      threshold: 100,
      used: 3000,
      limit: 3000,
    })
    expect(emit.mock.lastCall?.[0].kind).toBe(
      'CRM_NEWSLETTER_USAGE_LIMIT_REACHED',
    )
  })
})
