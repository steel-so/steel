import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppCoexistenceRepository } from '../whatsapp-coexistence.repository'

let counter = 0

async function seedConnection() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Coexistência',
      phoneNumber: `551199000${counter}`,
      metaPhoneNumberId: `pn-coex-${counter}`,
      coexistence: true,
      createdById: user.id,
    },
  })
  return { workspace, connection }
}

describe('WhatsAppCoexistenceRepository', () => {
  it('creates the sync row and finds it by connection', async () => {
    const { workspace, connection } = await seedConnection()
    const created = expectOk(
      await WhatsAppCoexistenceRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
      }),
    )
    expect(created.status).toBe('PENDING')
    expect(created.progress).toBe(0)

    const found = expectOk(
      await WhatsAppCoexistenceRepository.findByConnection(
        workspace.id,
        connection.id,
      ),
    )
    expect(found?.id).toBe(created.id)
    expect(
      expectOk(
        await WhatsAppCoexistenceRepository.findByConnection(
          'other-ws',
          connection.id,
        ),
      ),
    ).toBeNull()
  })

  it('rejects a second sync row for the same connection', async () => {
    const { workspace, connection } = await seedConnection()
    const data = { workspaceId: workspace.id, connectionId: connection.id }
    expectOk(await WhatsAppCoexistenceRepository.create(data))
    expectErr(await WhatsAppCoexistenceRepository.create(data), 'DATABASE_ERROR')
  })

  it('updates the progress and accumulates counters', async () => {
    const { workspace, connection } = await seedConnection()
    expectOk(
      await WhatsAppCoexistenceRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
      }),
    )
    await WhatsAppCoexistenceRepository.update(connection.id, {
      status: 'SYNCING',
      progress: 30,
      messagesImported: { increment: 10 },
    })
    const updated = expectOk(
      await WhatsAppCoexistenceRepository.update(connection.id, {
        progress: 60,
        messagesImported: { increment: 5 },
        contactsImported: { increment: 2 },
      }),
    )
    expect(updated).toMatchObject({
      status: 'SYNCING',
      progress: 60,
      messagesImported: 15,
      contactsImported: 2,
    })
  })

  it('returns null when there is no sync row to update', async () => {
    expect(
      expectOk(
        await WhatsAppCoexistenceRepository.update('missing', {
          status: 'FAILED',
        }),
      ),
    ).toBeNull()
  })

  it('bulk-inserts history and skips duplicates', async () => {
    const { workspace, connection } = await seedConnection()
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: `5511977${counter}` },
    })
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'CLOSED',
      },
    })
    const row = (id: string, createdAt: Date) => ({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: 'IN' as const,
      type: 'TEXT' as const,
      text: id,
      providerMessageId: `hist-${counter}-${id}`,
      status: 'DELIVERED' as const,
      createdAt,
    })
    const past = new Date('2025-01-01T10:00:00Z')

    expect(
      expectOk(
        await WhatsAppCoexistenceRepository.createHistoryMessages([
          row('a', past),
          row('b', past),
        ]),
      ),
    ).toBe(2)
    expect(
      expectOk(
        await WhatsAppCoexistenceRepository.createHistoryMessages([
          row('b', past),
          row('c', past),
        ]),
      ),
    ).toBe(1)

    const stored = await prisma.whatsAppMessage.findMany({
      where: { conversationId: conversation.id },
    })
    expect(stored).toHaveLength(3)
    expect(stored[0].createdAt).toEqual(past)
  })

  it('returns DATABASE_ERROR when a query throws', async () => {
    vi.spyOn(
      prisma.whatsAppCoexistenceSync,
      'findFirst',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppCoexistenceRepository.findByConnection('w', 'c'),
      'DATABASE_ERROR',
    )
    vi.spyOn(
      prisma.whatsAppCoexistenceSync,
      'updateMany',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppCoexistenceRepository.update('c', {}),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppMessage, 'createMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppCoexistenceRepository.createHistoryMessages([]),
      'DATABASE_ERROR',
    )
  })
})
