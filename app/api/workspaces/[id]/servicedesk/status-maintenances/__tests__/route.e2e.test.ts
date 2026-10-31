import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

const HOUR = 3_600_000
const iso = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * HOUR).toISOString()

async function setup() {
  const { user, workspace } = await authenticatedOwner()
  const api = `/api/workspaces/${workspace.id}/servicedesk`
  const created = await postJson(
    `${api}/status-pages`,
    { name: 'Acme Telefonia' },
    user.cookie,
  )
  expect(created.status).toBe(201)
  const page = (await created.json()).data
  return { user, workspace, api, page }
}

describe('status page components', () => {
  it('creates, changes the state, shows it publicly and removes', async () => {
    const { user, api, page } = await setup()

    const created = await postJson(
      `${api}/status-pages/${page.id}/components`,
      { name: 'Telefonia' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const component = (await created.json()).data
    expect(component.state).toBe('OPERATIONAL')

    const patched = await patchJson(
      `${api}/status-pages/${page.id}/components/${component.id}`,
      { state: 'OUTAGE' },
      user.cookie,
    )
    expect(patched.status).toBe(200)

    const list = await getJson(
      `${api}/status-pages/${page.id}/components`,
      user.cookie,
    )
    expect((await list.json()).data.items).toHaveLength(1)

    const publicPage = (
      await (await getJson(`/api/status-page/${page.slug}`)).json()
    ).data
    expect(publicPage.components).toEqual([
      { name: 'Telefonia', state: 'OUTAGE' },
    ])
    expect(publicPage.overall).toBe('MAJOR_OUTAGE')

    const removed = await deleteJson(
      `${api}/status-pages/${page.id}/components/${component.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    const gone = await deleteJson(
      `${api}/status-pages/${page.id}/components/${component.id}`,
      user.cookie,
    )
    expect(gone.status).toBe(404)
  })

  it('refuses an unknown service and a blank name', async () => {
    const { user, api, page } = await setup()
    const unknown = await postJson(
      `${api}/status-pages/${page.id}/components`,
      { name: 'Telefonia', serviceId: 'nao-existe' },
      user.cookie,
    )
    expect(unknown.status).toBe(422)
    const blank = await postJson(
      `${api}/status-pages/${page.id}/components`,
      { name: ' ' },
      user.cookie,
    )
    expect(blank.status).toBe(422)
  })

  it('keeps members that are not agents out', async () => {
    const { workspace, api, page } = await setup()
    const outsider = await addMember(workspace.id)
    const res = await getJson(
      `${api}/status-pages/${page.id}/components`,
      outsider.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('maintenance windows', () => {
  it('schedules, shows on the public page, reschedules and cancels', async () => {
    const { user, api, page } = await setup()
    const body = {
      title: 'Troca do switch',
      description: 'Queda curta.',
      startsAt: iso(24),
      endsAt: iso(28),
      pageIds: [page.id],
      notifySubscribers: false,
    }

    const created = await postJson(
      `${api}/status-maintenances`,
      body,
      user.cookie,
    )
    expect(created.status).toBe(201)
    const window = (await created.json()).data
    expect(window.phase).toBe('SCHEDULED')

    const publicPage = (
      await (await getJson(`/api/status-page/${page.slug}`)).json()
    ).data
    expect(publicPage.maintenances).toMatchObject([
      { id: window.id, title: 'Troca do switch', inProgress: false },
    ])
    // A maintenance announces itself; it does not degrade the page.
    expect(publicPage.overall).toBe('OPERATIONAL')

    const list = (
      await (await getJson(`${api}/status-maintenances`, user.cookie)).json()
    ).data
    expect(list.items).toHaveLength(1)

    const moved = await patchJson(
      `${api}/status-maintenances/${window.id}`,
      { startsAt: iso(48), endsAt: iso(52) },
      user.cookie,
    )
    expect(moved.status).toBe(200)

    const canceled = await deleteJson(
      `${api}/status-maintenances/${window.id}`,
      user.cookie,
    )
    expect(canceled.status).toBe(200)
    expect((await canceled.json()).data.phase).toBe('CANCELED')

    const after = (
      await (await getJson(`/api/status-page/${page.slug}`)).json()
    ).data
    expect(after.maintenances).toEqual([])

    const closed = await patchJson(
      `${api}/status-maintenances/${window.id}`,
      { title: 'Outro título' },
      user.cookie,
    )
    expect(closed.status).toBe(409)
  })

  it('validates the window and the references', async () => {
    const { user, api, page } = await setup()
    const base = {
      title: 'Troca do switch',
      pageIds: [page.id],
      notifySubscribers: false,
    }
    const backwards = await postJson(
      `${api}/status-maintenances`,
      { ...base, startsAt: iso(28), endsAt: iso(24) },
      user.cookie,
    )
    expect(backwards.status).toBe(422)

    const noItems = await postJson(
      `${api}/status-maintenances`,
      { ...base, startsAt: iso(24), endsAt: iso(28), suppressMonitoring: true },
      user.cookie,
    )
    expect(noItems.status).toBe(422)

    const unknownPage = await postJson(
      `${api}/status-maintenances`,
      { ...base, startsAt: iso(24), endsAt: iso(28), pageIds: ['nao-existe'] },
      user.cookie,
    )
    expect(unknownPage.status).toBe(422)

    const naive = await postJson(
      `${api}/status-maintenances`,
      {
        ...base,
        startsAt: '2030-01-01T10:00:00',
        endsAt: '2030-01-01T12:00:00',
      },
      user.cookie,
    )
    expect(naive.status).toBe(422)
  })

  it('does not reach windows of another workspace', async () => {
    const { user, api, page } = await setup()
    const created = await postJson(
      `${api}/status-maintenances`,
      {
        title: 'Troca do switch',
        startsAt: iso(24),
        endsAt: iso(28),
        pageIds: [page.id],
        notifySubscribers: false,
      },
      user.cookie,
    )
    const window = (await created.json()).data
    const other = await authenticatedOwner()
    const res = await patchJson(
      `/api/workspaces/${other.workspace.id}/servicedesk/status-maintenances/${window.id}`,
      { title: 'Invasão' },
      other.user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('keeps members that are not agents out', async () => {
    const { workspace, api } = await setup()
    const outsider = await addMember(workspace.id)
    const res = await getJson(`${api}/status-maintenances`, outsider.cookie)
    expect(res.status).toBe(403)
  })
})
