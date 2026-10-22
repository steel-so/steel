import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return counter
}

async function seedMetaConnection(workspaceId: string, userId: string) {
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      status: 'CONNECTED',
      label: 'Oficial',
      phoneNumber: `5511999${suffix()}`,
      metaPhoneNumberId: `phone-${suffix()}`,
      metaWabaId: `waba-${suffix()}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: userId,
    },
  })
}

describe('POST /api/workspaces/[id]/whatsapp/number-validations', () => {
  it('should refuse with 422 when the workspace only has the Meta Cloud API', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedMetaConnection(workspace.id, user.id)
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: '5511988887777' },
    })

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/number-validations`,
      { scope: 'CONTACTS', contactIds: [contact.id] },
      user.cookie,
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('WHATSAPP_VALIDATION_UNAVAILABLE')
    expect(body.message ?? body.error.message).toContain('Z-API')
    expect(await prisma.whatsAppNumberValidation.count()).toBe(0)
  })

  it('should return 422 for an invalid payload', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/number-validations`,
      { scope: 'BROADCAST' },
      user.cookie,
    )

    expect(res.status).toBe(422)
  })

  it('should return 401 without a session', async () => {
    const { workspace } = await authenticatedOwner()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/number-validations`,
      { scope: 'CONTACTS', all: true },
    )

    expect(res.status).toBe(401)
  })
})

describe('GET /api/workspaces/[id]/whatsapp/number-validations/[validationId]', () => {
  it('should return the progress of a run of the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connection = await seedMetaConnection(workspace.id, user.id)
    const run = await prisma.whatsAppNumberValidation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        requestedById: user.id,
        scope: 'CONTACTS',
        contactIds: ['c1', 'c2'],
        total: 2,
        processed: 1,
        withWhatsapp: 1,
        status: 'RUNNING',
      },
    })

    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/number-validations/${run.id}`,
      user.cookie,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      id: run.id,
      status: 'RUNNING',
      total: 2,
      processed: 1,
      withWhatsapp: 1,
    })
    expect(body.data.contactIds).toBeUndefined()
  })

  it('should not expose a run of another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const connection = await seedMetaConnection(
      other.workspace.id,
      other.user.id,
    )
    const run = await prisma.whatsAppNumberValidation.create({
      data: {
        workspaceId: other.workspace.id,
        connectionId: connection.id,
        scope: 'CONTACTS',
        contactIds: [],
      },
    })

    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/number-validations/${run.id}`,
      user.cookie,
    )

    expect(res.status).toBe(404)
  })
})
