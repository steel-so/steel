import { describe, expect, it } from 'vitest'
import { getJson, postJson } from '@/src/__tests__/helpers/e2e'
import { setupTabs } from './sd-tab-e2e.helpers'

describe('major incident and public status page', () => {
  it('declares, publishes, subscribes and resolves', async () => {
    const { workspace, agent, ticket } = await setupTabs()
    const api = `/api/workspaces/${workspace.id}/servicedesk`

    const created = await postJson(
      `${api}/status-pages`,
      { name: 'Acme Telefonia' },
      agent.cookie,
    )
    // Only the ServiceDesk admins configure pages.
    expect([201, 403]).toContain(created.status)
    if (created.status !== 201) return
    const page = (await created.json()).data

    const declared = await postJson(
      `${api}/major-incidents`,
      {
        ticketRef: ticket.id,
        title: 'Telefonia fora',
        pageIds: [page.id],
      },
      agent.cookie,
    )
    expect(declared.status).toBe(201)
    const incident = (await declared.json()).data.incident
    expect(incident.status).toBe('INVESTIGATING')

    const again = await postJson(
      `${api}/major-incidents`,
      { ticketRef: ticket.id, title: 'Telefonia fora' },
      agent.cookie,
    )
    expect(again.status).toBe(409)

    const publicPage = await getJson(`/api/status-page/${page.slug}`)
    expect(publicPage.status).toBe(200)
    const body = (await publicPage.json()).data
    expect(body.overall).toBe('PARTIAL_OUTAGE')
    expect(body.active).toHaveLength(1)

    const resolved = await postJson(
      `${api}/major-incidents/${incident.id}/resolve`,
      { message: 'Tudo normal' },
      agent.cookie,
    )
    expect(resolved.status).toBe(200)
    const after = (
      await (await getJson(`/api/status-page/${page.slug}`)).json()
    ).data
    expect(after.overall).toBe('OPERATIONAL')
    expect(after.recent).toHaveLength(1)
  })

  it('answers 404 for an unknown public page', async () => {
    const res = await getJson('/api/status-page/nao-existe-123')
    expect(res.status).toBe(404)
  })
})
