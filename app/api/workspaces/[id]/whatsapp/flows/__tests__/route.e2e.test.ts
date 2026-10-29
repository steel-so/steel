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

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function metaConnection(workspaceId: string, createdById: string) {
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `5511${suffix()}`,
      metaPhoneNumberId: `phone-${suffix()}`,
      metaWabaId: `waba-${suffix()}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById,
    },
  })
}

describe('/api/workspaces/[id]/whatsapp/flows', () => {
  it('creates a flow from a preset, edits it and shows the Flow JSON', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connection = await metaConnection(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/flows`

    const created = await postJson(
      base,
      { name: 'Cadastro', connectionId: connection.id, preset: 'SIGN_UP' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const flow = (await created.json()).data
    expect(flow).toMatchObject({
      status: 'DRAFT',
      crmAction: 'LEAD',
      sendable: false,
      hasUnpublishedChanges: true,
    })
    expect(flow.definition.screens).toHaveLength(2)

    const patched = await patchJson(
      `${base}/${flow.id}`,
      { name: 'Cadastro de clientes', ctaLabel: 'Começar' },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      name: 'Cadastro de clientes',
      ctaLabel: 'Começar',
    })

    const json = await getJson(`${base}/${flow.id}/meta-json`, user.cookie)
    expect(json.status).toBe(200)
    expect((await json.json()).data.json.screens).toHaveLength(2)

    const list = await getJson(base, user.cookie)
    const items = (await list.json()).data
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ sent: 0, completed: 0 })

    const responses = await getJson(
      `${base}/${flow.id}/responses?limit=5`,
      user.cookie,
    )
    expect((await responses.json()).data).toEqual({
      items: [],
      nextCursor: null,
    })

    const removed = await deleteJson(`${base}/${flow.id}`, user.cookie)
    expect(removed.status).toBe(200)
    expect((await getJson(`${base}/${flow.id}`, user.cookie)).status).toBe(404)
  })

  it('validates the body and the CRM mapping', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connection = await metaConnection(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/flows`

    const invalid = await postJson(base, { name: '' }, user.cookie)
    expect(invalid.status).toBe(422)

    const flow = (
      await (
        await postJson(
          base,
          { name: 'Pesquisa', connectionId: connection.id, preset: 'SURVEY' },
          user.cookie,
        )
      ).json()
    ).data
    const noMapping = await patchJson(
      `${base}/${flow.id}`,
      { crmAction: 'LEAD' },
      user.cookie,
    )
    expect(noMapping.status).toBe(422)
    expect((await noMapping.json()).error.code).toBe('WHATSAPP_FLOW_INVALID')

    const badScreens = await patchJson(
      `${base}/${flow.id}`,
      { definition: { screens: [] } },
      user.cookie,
    )
    expect(badScreens.status).toBe(422)
  })

  it('does not accept a Z-API connection or one from another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const zapi = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'ZAPI',
        label: 'Z-API',
        phoneNumber: `5511${suffix()}`,
        zapiInstanceId: `inst-${suffix()}`,
        encryptedZapiToken: 'enc:token',
        createdById: user.id,
      },
    })
    const base = `/api/workspaces/${workspace.id}/whatsapp/flows`
    const res = await postJson(
      base,
      { name: 'X', connectionId: zapi.id },
      user.cookie,
    )
    expect(res.status).toBe(400)

    const other = await authenticatedOwner()
    const foreign = await metaConnection(other.workspace.id, other.user.id)
    const cross = await postJson(
      base,
      { name: 'X', connectionId: foreign.id },
      user.cookie,
    )
    expect(cross.status).toBe(404)
    expect((await cross.json()).error.code).toBe(
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('keeps writes to OWNER/ADMIN and reads to members', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const connection = await metaConnection(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/flows`

    expect((await getJson(base, member.cookie)).status).toBe(200)
    const denied = await postJson(
      base,
      { name: 'X', connectionId: connection.id },
      member.cookie,
    )
    expect(denied.status).toBe(403)

    const flow = (
      await (
        await postJson(
          base,
          { name: 'Y', connectionId: connection.id },
          user.cookie,
        )
      ).json()
    ).data
    expect((await getJson(`${base}/${flow.id}`, member.cookie)).status).toBe(
      200,
    )
    expect(
      (
        await postJson(
          `${base}/${flow.id}/publish`,
          { publish: false },
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect((await deleteJson(`${base}/${flow.id}`, member.cookie)).status).toBe(
      403,
    )
  })

  it('does not leak flows across workspaces', async () => {
    const a = await authenticatedOwner()
    const b = await authenticatedOwner()
    const connection = await metaConnection(a.workspace.id, a.user.id)
    const flow = (
      await (
        await postJson(
          `/api/workspaces/${a.workspace.id}/whatsapp/flows`,
          { name: 'Privado', connectionId: connection.id },
          a.user.cookie,
        )
      ).json()
    ).data

    const other = await getJson(
      `/api/workspaces/${b.workspace.id}/whatsapp/flows/${flow.id}`,
      b.user.cookie,
    )
    expect(other.status).toBe(404)
    const outsider = await getJson(
      `/api/workspaces/${a.workspace.id}/whatsapp/flows/${flow.id}`,
      b.user.cookie,
    )
    expect(outsider.status).toBe(403)
  })

  it('refuses to send a flow that is not at Meta yet', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connection = await metaConnection(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/flows`
    const flow = (
      await (
        await postJson(
          base,
          { name: 'Rascunho', connectionId: connection.id },
          user.cookie,
        )
      ).json()
    ).data

    const send = await postJson(
      `${base}/${flow.id}/send`,
      { conversationId: 'whatever' },
      user.cookie,
    )
    expect(send.status).toBe(409)
    expect((await send.json()).error.code).toBe('WHATSAPP_FLOW_NOT_SENDABLE')

    const preview = await getJson(`${base}/${flow.id}/preview`, user.cookie)
    expect(preview.status).toBe(409)

    const deprecated = await postJson(
      `${base}/${flow.id}/deprecate`,
      {},
      user.cookie,
    )
    expect((await deprecated.json()).data.status).toBe('DEPRECATED')
    const locked = await patchJson(
      `${base}/${flow.id}`,
      { name: 'Novo' },
      user.cookie,
    )
    expect(locked.status).toBe(422)
  })
})
