import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
}))

import { notifyNewsletterReengagementSummary } from '../crm-newsletter-automation-notifications'
import {
  automationSkipReason,
  automationTags,
  chunk,
  errorMessage,
  subscriberLinks,
} from '../crm-newsletter-automation-shared'
import { emitNotification } from '../notification-emitter'

const emit = vi.mocked(emitNotification)
const base = {
  workspaceId: 'ws1',
  newsletterId: 'nl1',
  newsletterName: 'Novidades',
  createdById: 'u1',
  runKey: '2026-10',
}

describe('notifyNewsletterReengagementSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarizes the monthly send', async () => {
    await notifyNewsletterReengagementSummary({
      ...base,
      phase: 'sent',
      sent: 1,
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['u1'],
        kind: 'CRM_NEWSLETTER_REENGAGEMENT_SUMMARY',
        title: 'Reengajamento enviado: Novidades',
        body: '1 assinante inativo recebeu o e-mail "Quero continuar recebendo".',
        path: '/crm/newsletters/nl1?aba=configuracoes',
        dedupeKey: 'crm-newsletter-reengagement:nl1:sent:2026-10',
      }),
    )
    await notifyNewsletterReengagementSummary({ ...base, phase: 'sent' })
    expect(emit.mock.calls[1][0].body).toContain(
      '0 assinantes inativos receberam',
    )
  })

  it('summarizes the end of the grace period', async () => {
    await notifyNewsletterReengagementSummary({
      ...base,
      phase: 'resolved',
      reengaged: 2,
      unsubscribed: 1,
      flagged: 3,
    })
    expect(emit.mock.calls[0][0]).toMatchObject({
      title: 'Resultado do reengajamento: Novidades',
      body: '2 assinantes voltaram a interagir; 1 foi descadastrado por inatividade; 3 foram marcados como inativos.',
    })
    await notifyNewsletterReengagementSummary({
      ...base,
      phase: 'resolved',
      reengaged: 1,
      unsubscribed: 2,
      flagged: 1,
    })
    expect(emit.mock.calls[1][0].body).toBe(
      '1 assinante voltou a interagir; 2 foram descadastrados por inatividade; 1 foi marcado como inativo.',
    )
    await notifyNewsletterReengagementSummary({ ...base, phase: 'resolved' })
    expect(emit.mock.calls[2][0].body).toBe(
      '0 assinantes voltaram a interagir.',
    )
  })
})

describe('automation shared helpers', () => {
  it('builds the subscriber links without an issue recipient', () => {
    const links = subscriberLinks('ws1', {
      subscriberId: 's1',
      email: 'Ana@Example.com',
    })
    expect(links.pageUrl).toMatch(/\/newsletter\/sair\//)
    expect(links.oneClickUrl).toMatch(/\/api\/newsletters\/unsubscribe\//)
    expect(links.preferencesUrl).toMatch(/\/newsletter\/preferencias\//)
  })

  it('decides the skip reason', () => {
    const none = new Set<string>()
    const row = (subscriberStatus: string, email = 'a@x.com') => ({
      email,
      subscriberStatus,
    })
    expect(automationSkipReason(row('ACTIVE'), none)).toBeNull()
    expect(
      automationSkipReason(row('ACTIVE', 'A@x.com'), new Set(['a@x.com'])),
    ).toBe('OPTED_OUT')
    expect(automationSkipReason(row('BOUNCED'), none)).toBe('BOUNCED')
    expect(automationSkipReason(row('COMPLAINED'), none)).toBe('COMPLAINED')
    expect(automationSkipReason(row('PENDING'), none)).toBe('UNSUBSCRIBED')
  })

  it('tags, chunks and reads error messages', () => {
    expect(automationTags('welcome', 'a.b')).toEqual([
      { name: 'kind', value: 'newsletter' },
      { name: 'welcome', value: 'a_b' },
    ])
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(chunk([], 2)).toEqual([])
    expect(errorMessage(new Error('x'), 'f')).toBe('x')
    expect(errorMessage('x', 'f')).toBe('f')
  })
})
