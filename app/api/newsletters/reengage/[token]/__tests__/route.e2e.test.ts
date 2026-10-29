import { describe, expect, it } from 'vitest'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { createReengageToken } from '@/src/lib/newsletter/reengage-token'
import { prisma } from '@/src/lib/prisma'

/** Public "Quero continuar recebendo" (no session). */
async function seed(subscriber: {
  status: 'ACTIVE' | 'UNSUBSCRIBED'
  unsubscribeReason?: string
}) {
  const { user, workspace } = await authenticatedOwner()
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: 'news@news.acme-e2e.com.br',
    },
  })
  const row = await prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      email: `leitor-${workspace.id.slice(-6)}@example.com`,
      source: 'MANUAL',
      ...subscriber,
    },
  })
  const attempt = await prisma.crmNewsletterReengagement.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      subscriberId: row.id,
      email: row.email,
      cycle: '2026-10',
      status: subscriber.status === 'ACTIVE' ? 'WAITING' : 'UNSUBSCRIBED',
      sentAt: new Date(),
    },
  })
  return { subscriber: row, attempt, token: createReengageToken(attempt.id) }
}

const url = (token: string) => `${BASE_URL}/api/newsletters/reengage/${token}`

describe('/api/newsletters/reengage/[token]', () => {
  it('rejects an invalid token', async () => {
    const res = await fetch(url('bad'), { headers: defaultHeaders })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('CRM_NEWSLETTER_TOKEN_INVALID')
  })

  it('previews without writing, then confirms', async () => {
    const { attempt, subscriber, token } = await seed({ status: 'ACTIVE' })
    const preview = await fetch(url(token), { headers: defaultHeaders })
    expect(preview.status).toBe(200)
    expect((await preview.json()).data).toMatchObject({
      email: subscriber.email,
      newsletterName: 'Novidades',
      alreadyConfirmed: false,
    })
    expect(
      (
        await prisma.crmNewsletterReengagement.findUniqueOrThrow({
          where: { id: attempt.id },
        })
      ).status,
    ).toBe('WAITING')

    const confirmed = await fetch(url(token), {
      method: 'POST',
      headers: defaultHeaders,
    })
    expect(confirmed.status).toBe(200)
    expect((await confirmed.json()).data).toEqual({
      newsletterName: 'Novidades',
      resubscribed: false,
    })
    expect(
      await prisma.crmNewsletterReengagement.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
    ).toMatchObject({ status: 'REENGAGED' })
  })

  it('brings back a subscriber removed for inactivity', async () => {
    const { subscriber, token } = await seed({
      status: 'UNSUBSCRIBED',
      unsubscribeReason: 'inativo',
    })
    const res = await fetch(url(token), {
      method: 'POST',
      headers: defaultHeaders,
    })
    expect((await res.json()).data.resubscribed).toBe(true)
    expect(
      (
        await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
          where: { id: subscriber.id },
        })
      ).status,
    ).toBe('ACTIVE')
  })
})
