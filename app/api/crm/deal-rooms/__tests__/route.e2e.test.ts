import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

async function seedDeal(workspaceId: string, cookie: string) {
  const pipeline = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/pipelines`,
      { name: 'Vendas' },
      cookie,
    )
  ).json()
  const stage = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/pipelines/${pipeline.data.id}/stages`,
      { name: 'Negociação' },
      cookie,
    )
  ).json()
  const deal = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/opportunities`,
      {
        name: 'Plano anual',
        amount: 5000,
        pipelineId: pipeline.data.id,
        stageId: stage.data.id,
      },
      cookie,
    )
  ).json()
  return deal.data.id as string
}

const publicPost = (path: string, body: unknown) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify(body),
  })

describe('deal room', () => {
  it('should answer 404 for an unknown token', async () => {
    const res = await fetch(`${BASE_URL}/api/crm/deal-rooms/nope`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(404)
  })

  it('should run the whole negotiation between seller and customer', async () => {
    const { user, workspace } = await authenticatedOwner()
    const dealId = await seedDeal(workspace.id, user.cookie)
    const roomPath = `/api/workspaces/${workspace.id}/crm/opportunities/${dealId}/room`

    const none = await getJson(roomPath, user.cookie)
    expect((await none.json()).data).toBeNull()

    const saved = await putJson(
      roomPath,
      {
        enabled: true,
        welcomeMessage: 'Bem-vindo à sala',
        materials: [{ title: 'Deck', url: 'https://example.com/deck.pdf' }],
        actions: [
          { title: 'Enviar o contrato assinado', owner: 'CUSTOMER' },
          { title: 'Preparar a implantação', owner: 'SELLER' },
        ],
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const room = (await saved.json()).data
    expect(room.publicPath).toBe(`/sala/${room.token}`)
    const customerAction = room.actions.find(
      (a: { owner: string }) => a.owner === 'CUSTOMER',
    )
    const sellerAction = room.actions.find(
      (a: { owner: string }) => a.owner === 'SELLER',
    )

    const api = `/api/crm/deal-rooms/${room.token}`
    const view = await fetch(`${BASE_URL}${api}`, { headers: defaultHeaders })
    expect(view.status).toBe(200)
    expect((await view.json()).data).toMatchObject({
      title: 'Plano anual',
      welcomeMessage: 'Bem-vindo à sala',
    })

    const noVisitor = await publicPost(`${api}/messages`, {
      visitorId: 'ghost',
      body: 'Oi',
    })
    expect(noVisitor.status).toBe(422)

    const identified = await publicPost(`${api}/visitors`, {
      name: 'Ana Souza',
      email: 'ana@example.com',
    })
    expect(identified.status).toBe(201)
    const { visitorId } = (await identified.json()).data

    const opened = await publicPost(`${api}/events`, {
      visitorId,
      kind: 'MATERIAL_OPENED',
      targetId: room.materials[0].id,
    })
    expect(opened.status).toBe(201)

    expect(
      (await publicPost(`${api}/messages`, { visitorId, body: 'Fechamos?' }))
        .status,
    ).toBe(201)

    const done = await fetch(`${BASE_URL}${api}/actions/${customerAction.id}`, {
      method: 'PATCH',
      headers: defaultHeaders,
      body: JSON.stringify({ visitorId, done: true }),
    })
    expect(done.status).toBe(200)

    const forbiddenStep = await fetch(
      `${BASE_URL}${api}/actions/${sellerAction.id}`,
      {
        method: 'PATCH',
        headers: defaultHeaders,
        body: JSON.stringify({ visitorId, done: true }),
      },
    )
    expect(forbiddenStep.status).toBe(422)

    const reply = await postJson(
      `${roomPath}/messages`,
      { body: 'Fechamos sim!' },
      user.cookie,
    )
    expect(reply.status).toBe(201)

    const after = (await (await getJson(roomPath, user.cookie)).json()).data
    expect(after.visitors).toHaveLength(1)
    expect(
      after.events.map((e: { kind: string }) => e.kind).sort(),
    ).toEqual(['ACTION_COMPLETED', 'MATERIAL_OPENED', 'MESSAGE_SENT', 'ROOM_OPENED'])
    expect(
      after.actions.find((a: { id: string }) => a.id === customerAction.id).done,
    ).toBe(true)

    const chat = (await (await getJson(`${roomPath}/messages`, user.cookie)).json()).data
    expect(chat.map((m: { authorKind: string }) => m.authorKind)).toEqual([
      'CUSTOMER',
      'SELLER',
    ])

    // Switching the link off cuts the customer out; rotating it breaks the old one.
    await putJson(roomPath, { enabled: false }, user.cookie)
    expect(
      (await fetch(`${BASE_URL}${api}`, { headers: defaultHeaders })).status,
    ).toBe(404)
    const rotated = (
      await (await putJson(roomPath, { enabled: true, rotateToken: true }, user.cookie)).json()
    ).data
    expect(rotated.token).not.toBe(room.token)
    expect(
      (await fetch(`${BASE_URL}${api}`, { headers: defaultHeaders })).status,
    ).toBe(404)
  })

  it('should refuse a proposal that belongs to another deal', async () => {
    const { user, workspace } = await authenticatedOwner()
    const dealId = await seedDeal(workspace.id, user.cookie)
    const res = await putJson(
      `/api/workspaces/${workspace.id}/crm/opportunities/${dealId}/room`,
      { proposalId: 'nope' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})

describe('proposal payment', () => {
  it('should be off until an admin turns it on', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/proposals/some-proposal/charges`,
      { method: 'PIX' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('CRM_DEALS_PAYMENT_DISABLED')
  })

  it('should refuse the payment webhook of an unknown provider', async () => {
    const res = await publicPost('/api/crm/payments/webhook/nope', {})
    expect(res.status).toBe(404)
  })

  it('should keep the plain acceptance working while no signature is required', async () => {
    const res = await publicPost('/api/crm/proposals/no-such-token/sign', {
      signerName: 'Ana',
      image: 'data:image/png;base64,iVBORw0KGgo=',
    })
    expect(res.status).toBe(404)
    const patch = await patchJson('/api/workspaces/x/crm/deals-settings', {})
    expect(patch.status).toBe(401)
  })
})
