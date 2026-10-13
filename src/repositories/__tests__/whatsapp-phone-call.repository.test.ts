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
})
