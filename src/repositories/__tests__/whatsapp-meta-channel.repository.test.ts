import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppMetaChannelRepository } from '../whatsapp-meta-channel.repository'

describe('WhatsAppMetaChannelRepository settings', () => {
  it('returns null until saved, then upserts the same row', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await WhatsAppMetaChannelRepository.findSettings(workspace.id)),
    ).toBeNull()

    const created = expectOk(
      await WhatsAppMetaChannelRepository.upsertSettings(workspace.id, {}),
    )
    expect(created.coexistenceEnabled).toBe(false)

    const updated = expectOk(
      await WhatsAppMetaChannelRepository.upsertSettings(workspace.id, {
        coexistenceEnabled: true,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.coexistenceEnabled).toBe(true)
  })

  it('returns DATABASE_ERROR when a query throws', async () => {
    vi.spyOn(
      prisma.whatsAppMetaChannelSettings,
      'findUnique',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppMetaChannelRepository.findSettings('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppMetaChannelRepository.upsertSettings('missing', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppMetaChannelRepository connections', () => {
  it('lists coexistence connections, not plain WhatsApp ones', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const plain = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'ZAPI',
        label: 'Zap',
        phoneNumber: '5511999990000',
        zapiInstanceId: 'inst-meta-channel',
        encryptedZapiToken: 'enc:token',
        createdById: user.id,
      },
    })
    const coexisting = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'META',
        label: 'Coex',
        phoneNumber: '5511999990001',
        metaPhoneNumberId: 'pn-coex',
        coexistence: true,
        createdById: user.id,
      },
    })

    const list = expectOk(
      await WhatsAppMetaChannelRepository.listCoexistenceConnections(
        workspace.id,
      ),
    )
    const ids = list.map((c) => c.id)
    expect(ids).toContain(coexisting.id)
    expect(ids).not.toContain(plain.id)
  })

  it('returns DATABASE_ERROR when the listing throws', async () => {
    vi.spyOn(prisma.whatsAppConnection, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppMetaChannelRepository.listCoexistenceConnections('w'),
      'DATABASE_ERROR',
    )
  })
})
