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
// here calls it.
const URL_OK = 'https://203.0.113.10/pedidos/{orderId}'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

const connector = {
  key: 'consultar_pedido',
  name: 'Consultar pedido',
  description: 'Busca a situação de um pedido.',
  kind: 'LOOKUP',
  method: 'GET',
  urlTemplate: URL_OK,
  params: [{ name: 'orderId', description: 'Número', required: true }],
  headers: { Authorization: 'Bearer segredo' },
}

describe('/api/workspaces/[id]/ai/connectors', () => {
  it('requires a session', async () => {
    const res = await getJson(`${base(createId())}/connectors`)
    expect(res.status).toBe(401)
  })

  it('lets the owner manage connectors and never returns header values', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await postJson(
      `${base(workspace.id)}/connectors`,
      connector,
      user.cookie,
    )
    expect(created.status).toBe(201)
    const body = (await created.json()).data as {
      id: string
      headerNames: string[]
    }
    expect(body.headerNames).toEqual(['Authorization'])
    expect(JSON.stringify(body)).not.toContain('segredo')

    const row = await prisma.aiActionConnector.findUniqueOrThrow({
      where: { id: body.id },
    })
    expect(row.encryptedHeaders).not.toContain('segredo')

    const list = await getJson(`${base(workspace.id)}/connectors`, user.cookie)
    const data = (await list.json()).data as {
      connectors: { id: string }[]
      settings: { enabled: boolean }
    }
    expect(data.connectors.map((c) => c.id)).toEqual([body.id])
    expect(data.settings.enabled).toBe(false)

    const patched = await patchJson(
      `${base(workspace.id)}/connectors/${body.id}`,
      { enabled: false },
      user.cookie,
    )
    expect(patched.status).toBe(200)

    const removed = await deleteJson(
      `${base(workspace.id)}/connectors/${body.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
  })

  it('refuses private addresses, bad kinds and duplicated keys', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `${base(workspace.id)}/connectors`
    const privateHost = await postJson(
      url,
      { ...connector, urlTemplate: 'https://127.0.0.1/pedidos/{orderId}' },
      user.cookie,
    )
    expect(privateHost.status).toBe(422)
    const wrongMethod = await postJson(
      url,
      { ...connector, method: 'POST' },
      user.cookie,
    )
    expect(wrongMethod.status).toBe(422)
    expect((await postJson(url, connector, user.cookie)).status).toBe(201)
    expect((await postJson(url, connector, user.cookie)).status).toBe(409)
  })

  it('keeps connectors and settings away from regular members', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    expect(
      (await getJson(`${base(workspace.id)}/connectors`, member.cookie)).status,
    ).toBe(403)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/connectors`,
          connector,
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await patchJson(
          `${base(workspace.id)}/action-settings`,
          { enabled: true },
          member.cookie,
        )
      ).status,
    ).toBe(403)
  })

  it('switches the feature on and stores the WhatsApp allow-list', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await patchJson(
      `${base(workspace.id)}/action-settings`,
      {
        enabled: true,
        zapTools: [{ toolName: 'act_lookup', mode: 'AUTO' }],
        zapActorId: user.id,
      },
      user.cookie,
    )
    expect(res.status).toBe(200)
    const settings = await prisma.aiActionSettings.findUniqueOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(settings.enabled).toBe(true)
    expect(settings.zapActorId).toBe(user.id)

    const unknown = await patchJson(
      `${base(workspace.id)}/action-settings`,
      { zapTools: [{ toolName: 'nope_tool', mode: 'AUTO' }] },
      user.cookie,
    )
    expect(unknown.status).toBe(422)
  })
})
