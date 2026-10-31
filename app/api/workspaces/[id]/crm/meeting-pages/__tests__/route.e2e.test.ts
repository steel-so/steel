import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/** Public routes rate limit per IP: every call gets its own bucket. */
const anonIp = () => ({
  extraHeaders: {
    'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})
const pubGet = (path: string) => getJson(path, anonIp())
const pubPost = (path: string, body: unknown) => postJson(path, body, anonIp())

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/crm`

async function createPage(
  workspaceId: string,
  cookie: string,
  hostUserIds: string[],
  over: Record<string, unknown> = {},
) {
  return postJson(
    `${base(workspaceId)}/meeting-pages`,
    { title: 'Conversa com vendas', hostUserIds, minNoticeMinutes: 0, ...over },
    cookie,
  )
}

describe('meeting pages admin API', () => {
  it('should create, list, update and delete a page', async () => {
    const { user, workspace } = await authenticatedOwner()

    const created = await createPage(workspace.id, user.cookie, [user.id])
    expect(created.status).toBe(201)
    const page = (await created.json()).data
    expect(page.slug).toBe('conversa-com-vendas')
    expect(page.hosts[0].userId).toBe(user.id)

    const listed = await getJson(
      `${base(workspace.id)}/meeting-pages`,
      user.cookie,
    )
    expect(listed.status).toBe(200)
    expect((await listed.json()).data).toHaveLength(1)

    const patched = await patchJson(
      `${base(workspace.id)}/meeting-pages/${page.id}`,
      { title: 'Novo título', active: false },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      title: 'Novo título',
      active: false,
    })

    const removed = await deleteJson(
      `${base(workspace.id)}/meeting-pages/${page.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    const after = await getJson(
      `${base(workspace.id)}/meeting-pages`,
      user.cookie,
    )
    expect((await after.json()).data).toHaveLength(0)
    expect(
      (
        await patchJson(
          `${base(workspace.id)}/meeting-pages/${page.id}`,
          { title: 'Fantasma' },
          user.cookie,
        )
      ).status,
    ).toBe(404)
  })

  it('should generate distinct slugs and reject a taken explicit one', async () => {
    const { user, workspace } = await authenticatedOwner()
    await createPage(workspace.id, user.cookie, [user.id])

    const second = await createPage(workspace.id, user.cookie, [user.id])
    expect(second.status).toBe(201)
    expect((await second.json()).data.slug).not.toBe('conversa-com-vendas')

    const taken = await createPage(workspace.id, user.cookie, [user.id], {
      slug: 'conversa-com-vendas',
    })
    expect(taken.status).toBe(422)
    expect((await taken.json()).error.code).toBe('CRM_MEETING_INVALID')
  })

  it('should validate the payload and the hosts', async () => {
    const { user, workspace } = await authenticatedOwner()
    const outsider = await createAuthenticatedUser()

    const invalid = await createPage(workspace.id, user.cookie, [], {
      title: 'x',
    })
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).error.code).toBe('VALIDATION_ERROR')

    const notMember = await createPage(workspace.id, user.cookie, [outsider.id])
    expect(notMember.status).toBe(422)
    expect((await notMember.json()).error.code).toBe('CRM_MEETING_INVALID')

    const empty = await patchJson(
      `${base(workspace.id)}/meeting-pages/anything`,
      {},
      user.cookie,
    )
    expect(empty.status).toBe(422)
  })

  it('should require a session, membership and edit permission', async () => {
    const { user, workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const stranger = await createAuthenticatedUser()

    const anon = await fetch(`${BASE_URL}${base(workspace.id)}/meeting-pages`, {
      redirect: 'manual',
    })
    expect(anon.status).toBe(401)
    expect(
      (await getJson(`${base(workspace.id)}/meeting-pages`, stranger.cookie))
        .status,
    ).toBe(403)
    expect(
      (await getJson(`${base(workspace.id)}/meeting-pages`, viewer.cookie))
        .status,
    ).toBe(200)
    expect(
      (await createPage(workspace.id, viewer.cookie, [user.id])).status,
    ).toBe(403)
  })

  it('should not touch a page of another workspace', async () => {
    const a = await authenticatedOwner()
    const b = await authenticatedOwner()
    const page = (
      await (
        await createPage(a.workspace.id, a.user.cookie, [a.user.id])
      ).json()
    ).data

    expect(
      (
        await patchJson(
          `${base(b.workspace.id)}/meeting-pages/${page.id}`,
          { title: 'Invasor' },
          b.user.cookie,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await deleteJson(
          `${base(b.workspace.id)}/meeting-pages/${page.id}`,
          b.user.cookie,
        )
      ).status,
    ).toBe(404)
  })
})

describe('meeting availability API', () => {
  it('should return the default hours, then save new ones', async () => {
    const { user, workspace } = await authenticatedOwner()

    const initial = await getJson(
      `${base(workspace.id)}/meeting-availability`,
      user.cookie,
    )
    expect(initial.status).toBe(200)
    const data = (await initial.json()).data
    expect(data.hasCalendarFeed).toBe(false)
    expect(data.oauthProvidersEnabled).toBe(false)
    expect(Object.keys(data.weeklyHours)).toEqual(['1', '2', '3', '4', '5'])

    const saved = await putJson(
      `${base(workspace.id)}/meeting-availability`,
      {
        timezone: 'America/Recife',
        weeklyHours: { '2': [{ start: '08:00', end: '12:00' }] },
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const body = (await saved.json()).data
    expect(body.timezone).toBe('America/Recife')
    expect(body.weeklyHours).toEqual({
      '2': [{ start: '08:00', end: '12:00' }],
    })
  })

  it('should reject inverted hours and a private calendar address', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `${base(workspace.id)}/meeting-availability`

    const inverted = await putJson(
      url,
      {
        timezone: 'America/Sao_Paulo',
        weeklyHours: { '1': [{ start: '12:00', end: '09:00' }] },
      },
      user.cookie,
    )
    expect(inverted.status).toBe(422)

    const priv = await putJson(
      url,
      {
        timezone: 'America/Sao_Paulo',
        weeklyHours: {},
        icsUrl: 'https://127.0.0.1/agenda.ics',
      },
      user.cookie,
    )
    expect(priv.status).toBe(422)
    expect((await priv.json()).error.code).toBe('CRM_MEETING_INVALID')
  })

  it('should require membership', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    expect(
      (
        await getJson(
          `${base(workspace.id)}/meeting-availability`,
          stranger.cookie,
        )
      ).status,
    ).toBe(403)
  })
})

describe('meeting bookings admin API', () => {
  async function withBooking() {
    const { user, workspace } = await authenticatedOwner()
    const page = (
      await (await createPage(workspace.id, user.cookie, [user.id])).json()
    ).data
    const slots = (
      await (await pubGet(`/api/crm/meetings/${page.slug}/slots`)).json()
    ).data.slots as string[]
    const booked = await pubPost(`/api/crm/meetings/${page.slug}/book`, {
      startsAt: slots[0],
      name: 'Cliente Teste',
      email: 'cliente@example.com',
      timezone: 'America/Sao_Paulo',
      consent: true,
    })
    expect(booked.status).toBe(201)
    return { user, workspace, page, slots }
  }

  it('should list bookings by scope and mine', async () => {
    const { user, workspace } = await withBooking()
    const url = `${base(workspace.id)}/meeting-bookings`

    const upcoming = await getJson(`${url}?scope=upcoming`, user.cookie)
    expect(upcoming.status).toBe(200)
    const rows = (await upcoming.json()).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      guestName: 'Cliente Teste',
      hostName: user.name,
      status: 'CONFIRMED',
    })
    expect(
      (await (await getJson(`${url}?scope=past`, user.cookie)).json()).data,
    ).toHaveLength(0)
    expect(
      (await (await getJson(`${url}?mine=true`, user.cookie)).json()).data,
    ).toHaveLength(1)
    expect((await getJson(`${url}?scope=bogus`, user.cookie)).status).toBe(422)
  })

  it('should let the seller cancel a booking and free the slot', async () => {
    const { user, workspace, page, slots } = await withBooking()
    const url = `${base(workspace.id)}/meeting-bookings`
    const [row] = (await (await getJson(url, user.cookie)).json()).data

    const res = await deleteJson(`${url}/${row.id}`, user.cookie)

    expect(res.status).toBe(200)
    const after = (
      await (await getJson(`${url}?scope=all`, user.cookie)).json()
    ).data
    expect(after[0].status).toBe('CANCELED')
    const free = (
      await (await pubGet(`/api/crm/meetings/${page.slug}/slots`)).json()
    ).data.slots as string[]
    expect(free).toContain(slots[0])
  })

  it('should protect bookings from other workspaces, viewers and unknown ids', async () => {
    const { user, workspace } = await withBooking()
    const url = `${base(workspace.id)}/meeting-bookings`
    const [row] = (await (await getJson(url, user.cookie)).json()).data
    const viewer = await addMember(workspace.id, 'VIEWER')
    const other = await authenticatedOwner()

    expect((await deleteJson(`${url}/${row.id}`, viewer.cookie)).status).toBe(
      403,
    )
    expect(
      (
        await deleteJson(
          `${base(other.workspace.id)}/meeting-bookings/${row.id}`,
          other.user.cookie,
        )
      ).status,
    ).toBe(404)
    expect((await deleteJson(`${url}/inexistente`, user.cookie)).status).toBe(
      404,
    )
    expect((await getJson(url, other.user.cookie)).status).toBe(403)
  })
})
