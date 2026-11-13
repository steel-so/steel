import { describe, expect, it } from 'vitest'
import { authenticatedOwner, postJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return counter
}

async function seedConnectionAndTemplate(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Principal',
      phoneNumber: `5511999${suffix()}`,
      metaPhoneNumberId: `phone-${suffix()}`,
      metaWabaId: `waba-${suffix()}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: userId,
    },
  })
  const template = await prisma.whatsAppTemplate.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      name: `lembrete-${suffix()}`,
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá {{1}}, seu horário é {{2}}' }],
    },
  })
  return { connection, template }
}

describe('POST /api/workspaces/[id]/whatsapp/broadcasts/import', () => {
  it('should create a scheduled, queued broadcast from a valid csv', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection, template } = await seedConnectionAndTemplate(
      workspace.id,
      user.id,
    )
    const csv = [
      'telefone,nome,data_referencia,var_1,var_2',
      '11987654321,Maria,2099-08-15T09:00:00.000Z,Maria,15/08 às 09h',
      '11912345678,João,2099-08-16T14:00:00.000Z,João,16/08 às 14h',
    ].join('\n')

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/broadcasts/import`,
      {
        name: 'Lembretes de consulta',
        connectionId: connection.id,
        templateId: template.id,
        sendOffsetHours: 24,
        csv,
      },
      user.cookie,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.createdCount).toBe(2)
    expect(body.data.rejectedRows).toEqual([])
    expect(body.data.broadcastList.id).toBeTruthy()

    const list = await prisma.whatsAppBroadcastList.findUnique({
      where: { id: body.data.broadcastList.id },
      include: { recipients: true },
    })
    expect(list?.status).toBe('QUEUED')
    expect(list?.recipients).toHaveLength(2)
    expect(list?.recipients[0].scheduledAt).not.toBeNull()
  })

  it('should only preview on a dry run and create nothing', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection, template } = await seedConnectionAndTemplate(
      workspace.id,
      user.id,
    )
    const csv = [
      'telefone,nome,data_referencia,var_1,var_2',
      '11987654321,Maria,15/08/2099 09:30,Maria,09h30',
    ].join('\n')

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/broadcasts/import`,
      {
        name: 'Lembretes',
        connectionId: connection.id,
        templateId: template.id,
        sendOffsetHours: 24,
        csv,
        dryRun: true,
      },
      user.cookie,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.validCount).toBe(1)
    expect(body.data.preview[0].scheduledAt).toBe('2099-08-14T12:30:00.000Z')
    expect(
      await prisma.whatsAppBroadcastList.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0)
  })

  it('should return 422 for an invalid payload', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/broadcasts/import`,
      { name: '', connectionId: '', templateId: '', csv: '' },
      user.cookie,
    )

    expect(res.status).toBe(422)
  })

  it('should return 404 when the template does not exist', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection } = await seedConnectionAndTemplate(
      workspace.id,
      user.id,
    )

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/broadcasts/import`,
      {
        name: 'Lembretes',
        connectionId: connection.id,
        templateId: 'nonexistent',
        csv: 'telefone,data_referencia,var_1\n11987654321,2099-08-15,Maria',
      },
      user.cookie,
    )

    expect(res.status).toBe(404)
  })

  it('should partially succeed when some rows are invalid', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection, template } = await seedConnectionAndTemplate(
      workspace.id,
      user.id,
    )
    const csv = [
      'telefone,data_referencia,var_1,var_2',
      '11987654321,2099-08-15T09:00:00.000Z,Maria,09h',
      'telefone-invalido,2099-08-16T14:00:00.000Z,João,14h',
    ].join('\n')

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/broadcasts/import`,
      {
        name: 'Lembretes',
        connectionId: connection.id,
        templateId: template.id,
        csv,
      },
      user.cookie,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.createdCount).toBe(1)
    expect(body.data.rejectedRows).toHaveLength(1)
  })

  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await postJson(
      '/api/workspaces/ws1/whatsapp/broadcasts/import',
      { name: 'x', connectionId: 'c', templateId: 't', csv: 'x' },
    )
    expect(res.status).toBe(401)
  })
})
