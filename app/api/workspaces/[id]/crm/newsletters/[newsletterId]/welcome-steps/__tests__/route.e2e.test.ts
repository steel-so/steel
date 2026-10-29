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
import { prisma } from '@/src/lib/prisma'

async function seed() {
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
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}/welcome-steps`
  return { user, workspace, newsletter, base }
}

describe('/api/workspaces/[id]/crm/newsletters/[newsletterId]/welcome-steps', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/newsletters/y/welcome-steps`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 to non-members and VIEWERs writing, 404 across workspaces', async () => {
    const { workspace, newsletter, base } = await seed()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(base, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(base, viewer.cookie)).status).toBe(200)
    expect(
      (
        await postJson(
          base,
          { subject: 'Oi', delayValue: 0, delayUnit: 'DAYS' },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)

    const other = await seed()
    const res = await getJson(
      `/api/workspaces/${other.workspace.id}/crm/newsletters/${newsletter.id}/welcome-steps`,
      other.user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('CRM_NEWSLETTER_NOT_FOUND')
  })

  it('creates, edits, reorders, lists and deletes steps', async () => {
    const { user, base } = await seed()
    const first = await postJson(
      base,
      { subject: 'Boas-vindas!', delayValue: 0, delayUnit: 'DAYS' },
      user.cookie,
    )
    expect(first.status).toBe(201)
    const a = (await first.json()).data
    expect(a).toMatchObject({ position: 0, enabled: true })
    expect(a.builderDocument).toBeTruthy()

    const b = (
      await (
        await postJson(
          base,
          { subject: 'Conteúdos', delayValue: 2, delayUnit: 'DAYS' },
          user.cookie,
        )
      ).json()
    ).data
    expect(b.position).toBe(1)

    expect(
      (
        await postJson(
          base,
          { subject: '', delayValue: -1, delayUnit: 'DAYS' },
          user.cookie,
        )
      ).status,
    ).toBe(422)

    const patched = await patchJson(
      `${base}/${b.id}`,
      { enabled: false, delayValue: 12, delayUnit: 'HOURS' },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      enabled: false,
      delayValue: 12,
      delayUnit: 'HOURS',
    })
    expect(
      (await patchJson(`${base}/${b.id}`, { delayValue: 2 }, user.cookie))
        .status,
    ).toBe(422)

    const reordered = await postJson(
      `${base}/reorder`,
      { ids: [b.id, a.id] },
      user.cookie,
    )
    expect(reordered.status).toBe(200)
    expect(
      (await reordered.json()).data.map((s: { id: string }) => s.id),
    ).toEqual([b.id, a.id])
    expect(
      (await postJson(`${base}/reorder`, { ids: [a.id] }, user.cookie)).status,
    ).toBe(422)

    const list = (await (await getJson(base, user.cookie)).json()).data
    expect(list).toHaveLength(2)
    expect(list[0]).not.toHaveProperty('builderDocument')
    expect(list[0].stats).toEqual({ sent: 0, opened: 0, clicked: 0 })

    const detail = await getJson(`${base}/${a.id}`, user.cookie)
    expect((await detail.json()).data.builderDocument).toBeTruthy()

    expect((await deleteJson(`${base}/${a.id}`, user.cookie)).status).toBe(200)
    const missing = await getJson(`${base}/${a.id}`, user.cookie)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe(
      'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
    )
  })

  it('caps the series at 10 steps', async () => {
    const { user, base } = await seed()
    for (let index = 0; index < 10; index++) {
      const res = await postJson(
        base,
        { subject: `Etapa ${index}`, delayValue: index, delayUnit: 'DAYS' },
        user.cookie,
      )
      expect(res.status).toBe(201)
    }
    const res = await postJson(
      base,
      { subject: 'Demais', delayValue: 11, delayUnit: 'DAYS' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe(
      'CRM_NEWSLETTER_WELCOME_STEP_LIMIT_REACHED',
    )
  })
})
