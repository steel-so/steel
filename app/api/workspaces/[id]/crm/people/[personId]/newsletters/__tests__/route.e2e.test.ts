import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

async function scope() {
  const { user, workspace } = await authenticatedOwner()
  const crm = `/api/workspaces/${workspace.id}/crm`
  const person = (
    await (
      await postJson(
        `${crm}/people`,
        { name: 'Ana Souza', emails: ['Ana@Bridge-e2e.com'] },
        user.cookie,
      )
    ).json()
  ).data
  const newsletter = (
    await (
      await postJson(
        `${crm}/newsletters`,
        {
          name: 'Novidades',
          fromName: 'Acme',
          fromEmail: 'news@news.bridge-e2e.com',
          doubleOptIn: false,
        },
        user.cookie,
      )
    ).json()
  ).data
  return {
    user,
    workspace,
    crm,
    person,
    newsletter,
    base: `${crm}/people/${person.id}/newsletters`,
  }
}

describe('/api/workspaces/[id]/crm/people/[personId]/newsletters', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/people/p/newsletters`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 to a non-member and to a VIEWER subscribing', async () => {
    const { workspace, base, newsletter } = await scope()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(base, stranger.cookie)).status).toBe(403)

    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(base, viewer.cookie)).status).toBe(200)
    const created = await postJson(
      base,
      { newsletterId: newsletter.id },
      viewer.cookie,
    )
    expect(created.status).toBe(403)
  })

  it('subscribes, lists and unsubscribes the person', async () => {
    const { user, base, newsletter, person, crm } = await scope()

    const empty = (await (await getJson(base, user.cookie)).json()).data
    expect(empty).toMatchObject({
      personId: person.id,
      emails: ['ana@bridge-e2e.com'],
      subscriptions: [],
      available: [{ id: newsletter.id, name: 'Novidades' }],
    })

    const invalid = await postJson(base, {}, user.cookie)
    expect(invalid.status).toBe(422)
    const foreign = await postJson(
      base,
      { newsletterId: newsletter.id, email: 'outro@x.com' },
      user.cookie,
    )
    expect(foreign.status).toBe(422)

    const created = await postJson(
      base,
      { newsletterId: newsletter.id },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const subscribed = (await created.json()).data
    expect(subscribed.subscriptions).toHaveLength(1)
    expect(subscribed.subscriptions[0]).toMatchObject({
      newsletterId: newsletter.id,
      email: 'ana@bridge-e2e.com',
      status: 'ACTIVE',
      canUnsubscribe: true,
    })
    expect(subscribed.available).toEqual([])

    const again = await postJson(
      base,
      { newsletterId: newsletter.id },
      user.cookie,
    )
    expect(again.status).toBe(409)

    const subscriberId = subscribed.subscriptions[0].subscriberId
    const left = await deleteJson(`${base}/${subscriberId}`, user.cookie)
    expect(left.status).toBe(200)
    const after = (await left.json()).data
    expect(after.subscriptions[0]).toMatchObject({
      status: 'UNSUBSCRIBED',
      canUnsubscribe: false,
    })

    const twice = await deleteJson(`${base}/${subscriberId}`, user.cookie)
    expect(twice.status).toBe(422)

    // The bridge wrote the person timeline.
    const timeline = (
      await (
        await getJson(`${crm}/activities?personId=${person.id}`, user.cookie)
      ).json()
    ).data as { action: string }[]
    expect(timeline.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'NEWSLETTER_SUBSCRIBED',
        'NEWSLETTER_UNSUBSCRIBED',
      ]),
    )
  })

  it('returns 404 for a missing person or subscription', async () => {
    const { user, crm, base } = await scope()
    const missing = await getJson(
      `${crm}/people/missing/newsletters`,
      user.cookie,
    )
    expect(missing.status).toBe(404)
    const gone = await deleteJson(`${base}/missing`, user.cookie)
    expect(gone.status).toBe(404)
  })
})
