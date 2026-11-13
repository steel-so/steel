import { describe, expect, it } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import {
  seedSdDepartment,
  seedSdDepartmentMember,
  seedSdPhaseFlow,
  seedSdPriority,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const api = (ws: string) => `/api/workspaces/${ws}/servicedesk/tickets`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  await seedSdPhaseFlow(workspace.id, 'INCIDENT')
  await seedSdPriority(workspace.id, { name: 'P2', level: 2, isDefault: true })
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, owner.id, { isLead: true })
  const lead = await seedCrmLead(workspace.id, owner.id, {
    name: 'Lead Acme',
    emails: ['contato@acme.com.br'],
    phones: ['11988887777'],
  })
  return { owner, workspace, lead }
}

describe('ticket from a CRM lead', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}${api('x')}/by-source?source=lead&sourceId=l`,
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-member', async () => {
    const { workspace, lead } = await setup()
    const stranger = await createAuthenticatedUser()
    const res = await getJson(
      `${api(workspace.id)}/from-source?source=lead&sourceId=${lead.id}`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('returns 422 for an unknown source kind', async () => {
    const { owner, workspace } = await setup()
    const res = await getJson(
      `${api(workspace.id)}/by-source?source=nope&sourceId=x`,
      owner.cookie,
    )
    expect(res.status).toBe(422)
    const body = await postJson(
      `${api(workspace.id)}/from-source`,
      { source: 'nope', sourceId: 'x' },
      owner.cookie,
    )
    expect(body.status).toBe(422)
  })

  it('returns 404 for a lead of another workspace', async () => {
    const { owner, workspace } = await setup()
    const res = await postJson(
      `${api(workspace.id)}/from-source`,
      { source: 'lead', sourceId: 'missing', type: 'INCIDENT' },
      owner.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('previews, creates, lists and blocks a duplicate', async () => {
    const { owner, workspace, lead } = await setup()
    const base = api(workspace.id)

    const preview = await getJson(
      `${base}/from-source?source=lead&sourceId=${lead.id}`,
      owner.cookie,
    )
    expect(preview.status).toBe(200)
    expect((await preview.json()).data.title).toBe('Chamado do lead Lead Acme')

    const created = await postJson(
      `${base}/from-source`,
      { source: 'lead', sourceId: lead.id, type: 'INCIDENT' },
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const ticket = (await created.json()).data.ticket
    expect(ticket.code).toBe('INC-000001')
    expect(ticket.href).toContain('/servicedesk/tickets/1')

    const listed = await getJson(
      `${base}/by-source?source=lead&sourceId=${lead.id}`,
      owner.cookie,
    )
    expect((await listed.json()).data).toHaveLength(1)

    const again = await postJson(
      `${base}/from-source`,
      { source: 'lead', sourceId: lead.id, type: 'INCIDENT' },
      owner.cookie,
    )
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe(
      'SD_TICKET_SOURCE_HAS_OPEN_TICKET',
    )

    const forced = await postJson(
      `${base}/from-source`,
      {
        source: 'lead',
        sourceId: lead.id,
        type: 'INCIDENT',
        allowDuplicate: true,
      },
      owner.cookie,
    )
    expect(forced.status).toBe(201)
  })
})
