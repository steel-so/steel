import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppPhoneCallRepository } from '../whatsapp-phone-call.repository'

let counter = 0

async function seedConversation() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `call-instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777', name: 'Maria' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
    },
  })
  return { workspace, user, conversation }
}

function callData(
  ctx: Awaited<ReturnType<typeof seedConversation>>,
  hash: string,
) {
  return {
    workspaceId: ctx.workspace.id,
    conversationId: ctx.conversation.id,
    userId: ctx.user.id,
    deviceId: '123',
    extension: '200',
    destination: '5511988887777',
    callbackTokenHash: hash.padEnd(64, '0'),
  }
}

describe('WhatsAppPhoneCallRepository', () => {
  it('creates a queued call and finds it by the callback token hash', async () => {
    const ctx = await seedConversation()

    const call = expectOk(
      await WhatsAppPhoneCallRepository.create(callData(ctx, 'a')),
    )
    expect(call.status).toBe('QUEUED')

    const found = expectOk(
      await WhatsAppPhoneCallRepository.findByCallbackTokenHash(
        call.callbackTokenHash,
      ),
    )
    expect(found?.id).toBe(call.id)
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.findByCallbackTokenHash(
          'f'.repeat(64),
        ),
      ),
    ).toBeNull()
  })

  it('updates the call status', async () => {
    const ctx = await seedConversation()
    const call = expectOk(
      await WhatsAppPhoneCallRepository.create(callData(ctx, 'b')),
    )

    const updated = expectOk(
      await WhatsAppPhoneCallRepository.update(call.id, {
        status: 'COMPLETED',
        durationSeconds: 42,
      }),
    )
    expect(updated).toMatchObject({ status: 'COMPLETED', durationSeconds: 42 })
  })

  it('returns the latest call of the conversation, scoped to the workspace', async () => {
    const ctx = await seedConversation()
    expectOk(await WhatsAppPhoneCallRepository.create(callData(ctx, 'c')))
    const latest = expectOk(
      await WhatsAppPhoneCallRepository.create(callData(ctx, 'd')),
    )

    const found = expectOk(
      await WhatsAppPhoneCallRepository.findLatestByConversation(
        ctx.conversation.id,
        ctx.workspace.id,
      ),
    )
    expect(found?.id).toBe(latest.id)
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.findLatestByConversation(
          ctx.conversation.id,
          'other-workspace',
        ),
      ),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR on failures', async () => {
    const ctx = await seedConversation()

    expectErr(
      await WhatsAppPhoneCallRepository.create({
        ...callData(ctx, 'e'),
        conversationId: 'missing',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPhoneCallRepository.update('missing', { status: 'FAILED' }),
      'DATABASE_ERROR',
    )

    vi.spyOn(prisma.whatsAppPhoneCall, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppPhoneCallRepository.findByCallbackTokenHash('x'),
      'DATABASE_ERROR',
    )

    vi.spyOn(prisma.whatsAppPhoneCall, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppPhoneCallRepository.findLatestByConversation('c', 'w'),
      'DATABASE_ERROR',
    )
  })

  it('lists the calls of a record with the names, newest first', async () => {
    const ctx = await seedConversation()
    const older = expectOk(
      await WhatsAppPhoneCallRepository.create({
        ...callData(ctx, 'l1'),
        createdAt: new Date('2026-10-01T10:00:00Z'),
      }),
    )
    const newer = expectOk(
      await WhatsAppPhoneCallRepository.create({
        ...callData(ctx, 'l2'),
        createdAt: new Date('2026-10-02T10:00:00Z'),
      }),
    )

    const list = expectOk(
      await WhatsAppPhoneCallRepository.listBySource(ctx.workspace.id, {
        conversationId: ctx.conversation.id,
      }),
    )
    expect(list.map((c) => c.id)).toEqual([newer.id, older.id])
    expect(list[0].conversation.contact.name).toBe('Maria')
    expect(list[0].user?.name).toBe(ctx.user.name)

    // Another workspace never sees them.
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.listBySource('other-ws', {
          conversationId: ctx.conversation.id,
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.findWithNames(newer.id, 'other-ws'),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.findWithNames(
          newer.id,
          ctx.workspace.id,
        ),
      )?.id,
    ).toBe(newer.id)
    expect(
      expectOk(await WhatsAppPhoneCallRepository.findById(newer.id))?.id,
    ).toBe(newer.id)
  })

  it('lists expired recordings, knows the live keys and clears the audio', async () => {
    const ctx = await seedConversation()
    const now = new Date('2026-10-18T03:00:00Z')
    const expired = expectOk(
      await WhatsAppPhoneCallRepository.create({
        ...callData(ctx, 'r1'),
        recordingKey: `${ctx.workspace.id}/r1.wav`,
        recordingMimeType: 'audio/wav',
        recordingSizeBytes: 10,
        recordingExpiresAt: new Date('2026-10-17T03:00:00Z'),
      }),
    )
    await WhatsAppPhoneCallRepository.create({
      ...callData(ctx, 'r2'),
      recordingKey: `${ctx.workspace.id}/r2.wav`,
      recordingExpiresAt: new Date('2026-10-19T03:00:00Z'),
    })

    expect(
      expectOk(await WhatsAppPhoneCallRepository.listExpiredRecordings(now, 10)),
    ).toEqual([
      {
        id: expired.id,
        workspaceId: ctx.workspace.id,
        recordingKey: `${ctx.workspace.id}/r1.wav`,
      },
    ])
    expect(
      expectOk(
        await WhatsAppPhoneCallRepository.findExistingRecordingKeys([
          `${ctx.workspace.id}/r1.wav`,
          `${ctx.workspace.id}/gone.wav`,
        ]),
      ),
    ).toEqual(new Set([`${ctx.workspace.id}/r1.wav`]))
    expect(
      expectOk(await WhatsAppPhoneCallRepository.findExistingRecordingKeys([])),
    ).toEqual(new Set())

    const cleared = expectOk(
      await WhatsAppPhoneCallRepository.clearRecording(expired.id),
    )
    expect(cleared).toMatchObject({
      recordingKey: null,
      recordingMimeType: null,
      recordingSizeBytes: null,
      recordingExpiresAt: null,
    })
  })

  it('returns DATABASE_ERROR from the timeline and retention queries', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.spyOn(prisma.whatsAppPhoneCall, 'findUnique').mockImplementationOnce(
      boom as never,
    )
    expectErr(await WhatsAppPhoneCallRepository.findById('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.whatsAppPhoneCall, 'findFirst').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await WhatsAppPhoneCallRepository.findWithNames('x', 'w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppPhoneCall, 'findMany').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await WhatsAppPhoneCallRepository.listBySource('w', { sdTicketId: 't' }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppPhoneCall, 'findMany').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await WhatsAppPhoneCallRepository.listExpiredRecordings(new Date(), 1),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppPhoneCall, 'findMany').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await WhatsAppPhoneCallRepository.findExistingRecordingKeys(['k']),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPhoneCallRepository.clearRecording('missing'),
      'DATABASE_ERROR',
    )
  })
})
