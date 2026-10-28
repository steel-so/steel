import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const newsletterBody = {
  name: 'Novidades da Acme',
  fromName: 'Acme',
  fromEmail: 'news@news.acme-e2e.com',
}

describe('/api/workspaces/[id]/crm/newsletters', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/x/crm/newsletters`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 to a non-member and to a VIEWER creating', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const list = await getJson(
      `/api/workspaces/${workspace.id}/crm/newsletters`,
      stranger.cookie,
    )
    expect(list.status).toBe(403)

    const viewer = await addMember(workspace.id, 'VIEWER')
    const created = await postJson(
      `/api/workspaces/${workspace.id}/crm/newsletters`,
      newsletterBody,
      viewer.cookie,
    )
    expect(created.status).toBe(403)
  })

  it('creates (unverified sender), lists, archives and deletes', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/newsletters`

    const created = await postJson(base, newsletterBody, user.cookie)
    expect(created.status).toBe(201)
    const newsletter = (await created.json()).data
    expect(newsletter).toMatchObject({
      slug: 'novidades-da-acme',
      senderVerified: false,
      doubleOptIn: true,
      counts: { active: 0, pending: 0, issuesSent: 0 },
    })
    expect(newsletter.archiveUrl).toContain(
      `/n/${workspace.slug}/novidades-da-acme`,
    )

    const duplicate = await postJson(
      base,
      { ...newsletterBody, slug: 'novidades-da-acme' },
      user.cookie,
    )
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error.code).toBe(
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )

    const second = await postJson(base, newsletterBody, user.cookie)
    expect((await second.json()).data.slug).toBe('novidades-da-acme-2')

    const list = await getJson(base, user.cookie)
    expect((await list.json()).data).toHaveLength(2)

    const archived = await patchJson(
      `${base}/${newsletter.id}`,
      { status: 'ARCHIVED' },
      user.cookie,
    )
    expect(archived.status).toBe(200)
    const archivedBody = (await archived.json()).data
    expect(archivedBody.status).toBe('ARCHIVED')
    expect(archivedBody.archiveUrl).toBeNull()

    const invalid = await patchJson(`${base}/${newsletter.id}`, {}, user.cookie)
    expect(invalid.status).toBe(422)

    const deleted = await deleteJson(`${base}/${newsletter.id}`, user.cookie)
    expect(deleted.status).toBe(200)
    const gone = await getJson(`${base}/${newsletter.id}`, user.cookie)
    expect(gone.status).toBe(404)
  })

  it('manages subscribers: add, list, import, export, resend, remove', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/newsletters`
    const newsletter = (
      await (await postJson(base, newsletterBody, user.cookie)).json()
    ).data
    const subs = `${base}/${newsletter.id}/subscribers`

    const added = await postJson(
      subs,
      { email: 'Ana@Example.com', name: 'Ana' },
      user.cookie,
    )
    expect(added.status).toBe(201)
    const ana = (await added.json()).data
    expect(ana).toMatchObject({ email: 'ana@example.com', status: 'ACTIVE' })

    const again = await postJson(
      subs,
      { email: 'ana@example.com' },
      user.cookie,
    )
    expect(again.status).toBe(409)

    const pending = await postJson(
      subs,
      { email: 'bia@example.com', sendConfirmation: true },
      user.cookie,
    )
    const bia = (await pending.json()).data
    expect(bia.status).toBe('PENDING')
    const throttled = await postJson(
      `${subs}/${bia.id}/resend-confirmation`,
      {},
      user.cookie,
    )
    expect(throttled.status).toBe(429)

    const noConsent = await postJson(
      `${subs}/import`,
      { rows: [{ email: 'c@example.com' }] },
      user.cookie,
    )
    expect(noConsent.status).toBe(422)

    const imported = await postJson(
      `${subs}/import`,
      {
        rows: [
          { email: 'c@example.com', name: 'Carla' },
          { email: 'ana@example.com' },
          { email: 'not-an-email' },
        ],
        consentConfirmed: true,
      },
      user.cookie,
    )
    expect(imported.status).toBe(200)
    expect((await imported.json()).data).toMatchObject({
      created: 1,
      reactivated: 0,
      unchanged: 1,
      rejected: [{ row: 3, reason: 'E-mail inválido' }],
    })

    const page = await getJson(`${subs}?status=ACTIVE&pageSize=10`, user.cookie)
    const pageBody = (await page.json()).data
    expect(pageBody.total).toBe(2)

    const badQuery = await getJson(`${subs}?status=NOPE`, user.cookie)
    expect(badQuery.status).toBe(422)

    const exported = await fetch(`${BASE_URL}${subs}/export`, {
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect(await exported.text()).toContain('ana@example.com')

    const removed = await deleteJson(`${subs}/${ana.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const missing = await deleteJson(`${subs}/${ana.id}`, user.cookie)
    expect(missing.status).toBe(404)

    const detail = await getJson(`${base}/${newsletter.id}`, user.cookie)
    expect((await detail.json()).data.counts).toMatchObject({
      active: 1,
      pending: 1,
    })
  })
})
