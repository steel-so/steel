import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import {
  createPreferencesToken,
  createUnsubscribeToken,
} from '@/src/lib/newsletter/tokens'
import { prisma } from '@/src/lib/prisma'

async function setup(doubleOptIn = false) {
  const { user, workspace } = await authenticatedOwner()
  const created = await postJson(
    `/api/workspaces/${workspace.id}/crm/newsletters`,
    {
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: 'news@news.acme-e2e.com',
      doubleOptIn,
    },
    user.cookie,
  )
  const newsletter = (await created.json()).data
  return { user, workspace, newsletter }
}

describe('POST /api/newsletters/subscribe', () => {
  it('subscribes without a session and answers the same for repeats', async () => {
    const { workspace } = await setup(false)
    const body = {
      workspaceSlug: workspace.slug,
      newsletterSlug: 'novidades',
      email: 'Leitor@Example.com',
      consent: true,
    }
    const first = await postJson('/api/newsletters/subscribe', body)
    expect(first.status).toBe(200)
    expect((await first.json()).data).toEqual({
      requiresConfirmation: false,
      status: 'ACTIVE',
    })
    expect(first.headers.get('access-control-allow-origin')).toBe('*')

    const repeat = await postJson('/api/newsletters/subscribe', body)
    expect((await repeat.json()).data).toEqual({
      requiresConfirmation: false,
      status: 'ACTIVE',
    })

    const row = await prisma.crmNewsletterSubscriber.findFirstOrThrow({
      where: { email: 'leitor@example.com' },
    })
    expect(row).toMatchObject({ status: 'ACTIVE', source: 'PUBLIC_PAGE' })
    expect(row.consentText).toBeTruthy()
  })

  it('ignores the honeypot and validates the consent', async () => {
    const { workspace } = await setup(true)
    const base = {
      workspaceSlug: workspace.slug,
      newsletterSlug: 'novidades',
      email: 'bot@example.com',
    }
    const bot = await postJson('/api/newsletters/subscribe', {
      ...base,
      consent: true,
      website: 'spam',
    })
    expect(bot.status).toBe(200)
    expect(
      await prisma.crmNewsletterSubscriber.count({
        where: { email: 'bot@example.com' },
      }),
    ).toBe(0)

    const noConsent = await postJson('/api/newsletters/subscribe', base)
    expect(noConsent.status).toBe(422)

    const unknown = await postJson('/api/newsletters/subscribe', {
      ...base,
      newsletterSlug: 'nao-existe',
      consent: true,
    })
    expect(unknown.status).toBe(404)
  })

  it('answers the CORS preflight', async () => {
    const res = await fetch(`${BASE_URL}/api/newsletters/subscribe`, {
      method: 'OPTIONS',
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

describe('unsubscribe and preferences', () => {
  it('one-click unsubscribe, page redirect and preference center', async () => {
    const { workspace, newsletter, user } = await setup(false)
    const added = await postJson(
      `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}/subscribers`,
      { email: 'ana@example.com' },
      user.cookie,
    )
    const subscriber = (await added.json()).data
    const token = createUnsubscribeToken({ subscriberId: subscriber.id })

    const redirect = await fetch(
      `${BASE_URL}/api/newsletters/unsubscribe/${token}`,
      { headers: defaultHeaders, redirect: 'manual' },
    )
    expect(redirect.status).toBe(303)
    expect(redirect.headers.get('location')).toContain(
      `/newsletter/sair/${token}`,
    )

    const oneClick = await fetch(
      `${BASE_URL}/api/newsletters/unsubscribe/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      },
    )
    expect(oneClick.status).toBe(200)
    expect((await oneClick.json()).data).toMatchObject({
      email: 'ana@example.com',
      alreadyUnsubscribed: false,
    })

    const again = await postJson(`/api/newsletters/unsubscribe/${token}`, {
      reason: 'ok',
    })
    expect((await again.json()).data.alreadyUnsubscribed).toBe(true)

    const bad = await postJson('/api/newsletters/unsubscribe/forged.token', {})
    expect(bad.status).toBe(404)

    const prefsToken = createPreferencesToken({
      workspaceId: workspace.id,
      email: 'ana@example.com',
    })
    const prefs = await getJson(`/api/newsletters/preferences/${prefsToken}`)
    expect(prefs.status).toBe(200)
    expect((await prefs.json()).data.newsletters).toEqual([
      expect.objectContaining({ id: newsletter.id, subscribed: false }),
    ])

    const saved = await putJson(`/api/newsletters/preferences/${prefsToken}`, {
      subscribedNewsletterIds: [newsletter.id],
    })
    expect((await saved.json()).data.newsletters[0].subscribed).toBe(true)

    const all = await putJson(`/api/newsletters/preferences/${prefsToken}`, {
      subscribedNewsletterIds: [],
      unsubscribeAll: true,
    })
    expect((await all.json()).data.optedOutOfAll).toBe(true)
    expect(
      await prisma.crmEmailOptOut.count({
        where: { workspaceId: workspace.id, source: 'PREFERENCES' },
      }),
    ).toBe(1)
  })
})
