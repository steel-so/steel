import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

// A public literal (TEST-NET-3): passes the SSRF guard without DNS. Nothing
// here sends to it — the ping is covered by the unit tests.
const URL_OK = 'https://203.0.113.10/steel'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/webhooks`

async function createEndpoint(workspaceId: string, cookie: string) {
  const res = await postJson(
    `${base(workspaceId)}/endpoints`,
    { url: URL_OK, events: ['crm.lead.created'], description: 'ERP' },
    cookie,
  )
  expect(res.status).toBe(201)
  return (await res.json()).data as {
    endpoint: { id: string; secretHint: string }
    secret: string
  }
}

describe('/api/workspaces/[id]/webhooks', () => {
  it('requires a session', async () => {
    const res = await getJson(`${base(createId())}/endpoints`)
    expect(res.status).toBe(401)
  })

  it('lets the owner manage an endpoint end to end', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await createEndpoint(workspace.id, user.cookie)
    expect(created.secret).toMatch(/^whsec_/)
    expect(created.endpoint.secretHint).toBe(
      `whsec_…${created.secret.slice(-4)}`,
    )

    const row = await prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: created.endpoint.id },
    })
    expect(row.encryptedSecret).not.toContain(created.secret)

    const list = await getJson(`${base(workspace.id)}/endpoints`, user.cookie)
    expect(list.status).toBe(200)
    expect((await list.json()).data.items).toHaveLength(1)

    const patched = await patchJson(
      `${base(workspace.id)}/endpoints/${created.endpoint.id}`,
      { events: ['*'], active: false },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      events: ['*'],
      active: false,
      disabledReason: 'manual',
    })

    const reveal = await getJson(
      `${base(workspace.id)}/endpoints/${created.endpoint.id}/secret`,
      user.cookie,
    )
    expect((await reveal.json()).data.secret).toBe(created.secret)

    const rotate = await postJson(
      `${base(workspace.id)}/endpoints/${created.endpoint.id}/secret`,
      {},
      user.cookie,
    )
    expect(rotate.status).toBe(200)
    expect((await rotate.json()).data.secret).not.toBe(created.secret)

    const deliveries = await getJson(
      `${base(workspace.id)}/deliveries?endpointId=${created.endpoint.id}`,
      user.cookie,
    )
    expect((await deliveries.json()).data).toEqual({
      items: [],
      nextCursor: null,
    })

    const removed = await deleteJson(
      `${base(workspace.id)}/endpoints/${created.endpoint.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    const gone = await patchJson(
      `${base(workspace.id)}/endpoints/${created.endpoint.id}`,
      { active: true },
      user.cookie,
    )
    expect(gone.status).toBe(404)
  })

  it('re-delivers a logged delivery on request', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await createEndpoint(workspace.id, user.cookie)
    const delivery = await prisma.webhookDelivery.create({
      data: {
        workspaceId: workspace.id,
        endpointId: created.endpoint.id,
        eventId: `evt_${createId()}`,
        eventType: 'crm.lead.created',
        body: '{}',
        status: 'FAILED',
        attempts: 6,
      },
    })
    const res = await postJson(
      `${base(workspace.id)}/deliveries/${delivery.id}/retry`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(202)
    expect((await res.json()).data).toMatchObject({
      id: delivery.id,
      status: 'PENDING',
    })
  })

  it('refuses private URLs and invalid input', async () => {
    const { user, workspace } = await authenticatedOwner()
    for (const url of [
      'https://127.0.0.1/hook',
      'https://10.1.2.3/hook',
      'https://169.254.169.254/x',
    ]) {
      const res = await postJson(
        `${base(workspace.id)}/endpoints`,
        { url, events: ['*'] },
        user.cookie,
      )
      expect(res.status).toBe(422)
      expect((await res.json()).error.code).toBe('WEBHOOK_URL_NOT_ALLOWED')
    }
    const http = await postJson(
      `${base(workspace.id)}/endpoints`,
      { url: 'http://203.0.113.10/x', events: ['*'] },
      user.cookie,
    )
    expect((await http.json()).error.code).toBe('VALIDATION_ERROR')
    const unknown = await postJson(
      `${base(workspace.id)}/endpoints`,
      { url: URL_OK, events: ['nope'] },
      user.cookie,
    )
    expect(unknown.status).toBe(422)
  })

  it('refuses members and other workspaces', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await createEndpoint(workspace.id, user.cookie)
    const member = await addMember(workspace.id, 'MEMBER')
    const asMember = await getJson(
      `${base(workspace.id)}/endpoints`,
      member.cookie,
    )
    expect(asMember.status).toBe(403)
    const create = await postJson(
      `${base(workspace.id)}/endpoints`,
      { url: URL_OK, events: ['*'] },
      member.cookie,
    )
    expect(create.status).toBe(403)

    const other = await authenticatedOwner()
    const cross = await patchJson(
      `${base(other.workspace.id)}/endpoints/${created.endpoint.id}`,
      { active: false },
      other.user.cookie,
    )
    expect(cross.status).toBe(404)
    const outsider = await getJson(
      `${base(workspace.id)}/endpoints`,
      other.user.cookie,
    )
    expect(outsider.status).toBe(403)
  })
})
