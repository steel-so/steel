import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, sendingDomainNotVerified } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/lib/sending-domain/resolve-sender')
vi.mock('@/src/lib/mail/crm/send-newsletter-confirmation')
vi.mock('@/src/repositories/crm-newsletter-subscriber.repository')
vi.mock('@/lib/axiom/logger')

import { logger } from '@/lib/axiom/logger'
import { sendCrmNewsletterConfirmationEmail } from '@/src/lib/mail/crm/send-newsletter-confirmation'
import { verifyConfirmToken } from '@/src/lib/newsletter/tokens'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterSubscriberRepository } from '@/src/repositories/crm-newsletter-subscriber.repository'
import {
  confirmResendWaitSeconds,
  formatSender,
  sendNewsletterConfirmation,
} from '../crm-newsletter-confirmation'

const resolveSender = vi.mocked(resolveVerifiedSender)
const sendMail = vi.mocked(sendCrmNewsletterConfirmationEmail)
const repo = vi.mocked(CrmNewsletterSubscriberRepository)

const now = new Date('2026-10-28T12:00:00.000Z')
const input = {
  subscriber: { id: 's1', email: 'ana@empresa.com.br', name: 'Ana' },
  newsletter: {
    workspaceId: 'ws1',
    name: 'Novidades',
    fromName: 'Acme "News"',
    fromEmail: 'news@news.acme.com.br',
    replyTo: null,
  },
  publisherName: 'Acme',
  now,
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveSender.mockResolvedValue(ok({ sendingDomainId: 'dom1' }))
  sendMail.mockResolvedValue({ id: 'm1' } as never)
  repo.update.mockResolvedValue(ok({} as never))
})

describe('confirmResendWaitSeconds', () => {
  it('is zero without a previous e-mail or after 10 minutes', () => {
    expect(confirmResendWaitSeconds({ confirmSentAt: null }, now)).toBe(0)
    expect(
      confirmResendWaitSeconds(
        { confirmSentAt: new Date(now.getTime() - 10 * 60 * 1000) },
        now,
      ),
    ).toBe(0)
  })
  it('counts the seconds left inside the window', () => {
    expect(
      confirmResendWaitSeconds(
        { confirmSentAt: new Date(now.getTime() - 60 * 1000) },
        now,
      ),
    ).toBe(540)
  })
})

describe('formatSender', () => {
  it('quotes the name and drops header-breaking characters', () => {
    expect(formatSender('Acme "News"\n', 'a@b.com')).toBe(
      '"Acme News" <a@b.com>',
    )
    expect(formatSender('  ', 'a@b.com')).toBe('a@b.com')
  })
})

describe('sendNewsletterConfirmation', () => {
  it('sends from the verified domain with a working confirm link', async () => {
    expect(expectOk(await sendNewsletterConfirmation(input))).toBe(true)
    const call = sendMail.mock.calls[0][0]
    expect(call).toMatchObject({
      to: 'ana@empresa.com.br',
      from: '"Acme News" <news@news.acme.com.br>',
      replyTo: undefined,
      newsletterName: 'Novidades',
      publisherName: 'Acme',
      expiresInDays: 7,
    })
    const token = call.confirmUrl.split('/newsletter/confirmar/')[1]
    expect(verifyConfirmToken(token, now)).toMatchObject({
      ok: true,
      value: { subscriberId: 's1' },
    })
    expect(repo.update).toHaveBeenCalledWith('s1', { confirmSentAt: now })
  })

  it('falls back to the Steel address with Reply-To when unverified', async () => {
    resolveSender.mockResolvedValue(err(sendingDomainNotVerified()))
    expectOk(await sendNewsletterConfirmation(input))
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: '"Acme News" <notificacoes@stratustelecom.com.br>',
      replyTo: 'news@news.acme.com.br',
    })
  })

  it('keeps an explicit replyTo in both cases', async () => {
    const withReply = {
      ...input,
      newsletter: { ...input.newsletter, replyTo: 'contato@acme.com.br' },
    }
    expectOk(await sendNewsletterConfirmation(withReply))
    resolveSender.mockResolvedValue(err(sendingDomainNotVerified()))
    expectOk(await sendNewsletterConfirmation(withReply))
    expect(sendMail.mock.calls.map((c) => c[0].replyTo)).toEqual([
      'contato@acme.com.br',
      'contato@acme.com.br',
    ])
  })

  it('answers ok(false) and logs when the provider fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('boom'))
    expect(expectOk(await sendNewsletterConfirmation(input))).toBe(false)
    sendMail.mockRejectedValueOnce('plain')
    expect(expectOk(await sendNewsletterConfirmation(input))).toBe(false)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2)
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    resolveSender.mockResolvedValue(err(databaseError()))
    expectErr(await sendNewsletterConfirmation(input), 'DATABASE_ERROR')
    resolveSender.mockResolvedValue(ok({ sendingDomainId: 'd' }))
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(await sendNewsletterConfirmation(input), 'DATABASE_ERROR')
  })
})
