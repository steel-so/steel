import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppMessageRepository } from '../whatsapp-message.repository'

let counter = 0
async function seedConversation() {
  counter += 1
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
    },
  })
  return { workspace, conversation }
}

describe('WhatsAppMessageRepository', () => {
  describe('create() + listByConversation()', () => {
    it('should list messages for a conversation in chronological order', async () => {
      const { workspace, conversation } = await seedConversation()

      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'Primeira mensagem',
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Segunda mensagem',
      })

      const result = expectOk(
        await WhatsAppMessageRepository.listByConversation(conversation.id, {
          limit: 50,
        }),
      )

      expect(result.map((m) => m.text)).toEqual([
        'Primeira mensagem',
        'Segunda mensagem',
      ])
    })

    it('should exclude soft-deleted messages', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'Visível',
      })
      const deleted = expectOk(
        await WhatsAppMessageRepository.create({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: 'IN',
          type: 'TEXT',
          text: 'Apagada',
        }),
      )
      await WhatsAppMessageRepository.update(deleted.id, {
        deletedAt: new Date(),
      })

      const result = expectOk(
        await WhatsAppMessageRepository.listByConversation(conversation.id, {
          limit: 50,
        }),
      )

      expect(result.map((m) => m.text)).toEqual(['Visível'])
    })

    it('should only return messages created after the "after" cursor', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'Antes de limpar',
      })
      const cursor = new Date()
      await new Promise((resolve) => setTimeout(resolve, 5))
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'Depois de limpar',
      })

      const result = expectOk(
        await WhatsAppMessageRepository.listByConversation(conversation.id, {
          limit: 50,
          after: cursor,
        }),
      )

      expect(result.map((m) => m.text)).toEqual(['Depois de limpar'])
    })
  })

  describe('findByProviderMessageId()', () => {
    it('should support dedupe lookups', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'Olá',
        providerMessageId: 'pm-unique-1',
      })

      const found = expectOk(
        await WhatsAppMessageRepository.findByProviderMessageId('pm-unique-1'),
      )
      const missing = expectOk(
        await WhatsAppMessageRepository.findByProviderMessageId('unknown'),
      )

      expect(found?.text).toBe('Olá')
      expect(missing).toBeNull()
    })
  })

  describe('updateStatusByProviderMessageId()', () => {
    it('should update the status of the matching message', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Olá',
        providerMessageId: 'pm-status-1',
        status: 'SENT',
      })

      const updated = expectOk(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'pm-status-1',
          'READ',
        ),
      )

      expect(updated?.status).toBe('READ')
    })

    it('should persist the failure reason of a FAILED message and clear it later', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Olá',
        providerMessageId: 'pm-status-fail',
        status: 'SENT',
      })

      const failed = expectOk(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'pm-status-fail',
          'FAILED',
          '131047: Re-engagement message',
        ),
      )
      expect(failed?.failureReason).toBe('131047: Re-engagement message')

      const recovered = expectOk(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'pm-status-fail',
          'DELIVERED',
        ),
      )
      expect(recovered?.failureReason).toBeNull()
    })

    it('should store a null reason when a FAILED status carries none', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Olá',
        providerMessageId: 'pm-status-fail-2',
        status: 'SENT',
      })

      const failed = expectOk(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'pm-status-fail-2',
          'FAILED',
        ),
      )
      expect(failed?.failureReason).toBeNull()
    })

    it('should return null instead of throwing for an unknown providerMessageId', async () => {
      const result = expectOk(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'never-existed',
          'READ',
        ),
      )

      expect(result).toBeNull()
    })
  })

  describe('pagination and latest/sentiment reads', () => {
    async function seedTimeline() {
      const { workspace, conversation } = await seedConversation()
      const base = Date.parse('2026-09-01T12:00:00Z')
      const messages = []
      for (let i = 0; i < 4; i += 1) {
        messages.push(
          await prisma.whatsAppMessage.create({
            data: {
              workspaceId: workspace.id,
              conversationId: conversation.id,
              direction: i % 2 === 0 ? 'IN' : 'OUT',
              type: 'TEXT',
              text: `m${i}`,
              createdAt: new Date(base + i * 60_000),
              sentimentScore: i === 1 ? null : i / 10,
            },
          }),
        )
      }
      return { workspace, conversation, messages }
    }

    it('should page backwards from a cursor and return chronological pages', async () => {
      const { conversation, messages } = await seedTimeline()

      const firstPage = expectOk(
        await WhatsAppMessageRepository.listByConversation(conversation.id, {
          limit: 2,
        }),
      )
      expect(firstPage.map((m) => m.text)).toEqual(['m2', 'm3'])

      const nextPage = expectOk(
        await WhatsAppMessageRepository.listByConversation(conversation.id, {
          limit: 2,
          cursor: messages[2].id,
        }),
      )
      expect(nextPage.map((m) => m.text)).toEqual(['m0', 'm1'])
    })

    it('should return the latest messages newest first', async () => {
      const { conversation } = await seedTimeline()
      const latest = expectOk(
        await WhatsAppMessageRepository.listLatestByConversation(
          conversation.id,
          3,
        ),
      )
      expect(latest.map((m) => m.text)).toEqual(['m3', 'm2', 'm1'])
    })

    it('should return only classified sentiment scores, newest first', async () => {
      const { conversation } = await seedTimeline()
      const scores = expectOk(
        await WhatsAppMessageRepository.listRecentSentimentScores(
          conversation.id,
          10,
        ),
      )
      expect(scores).toEqual([0.3, 0.2, 0])
    })

    it('should coerce a null score to 0 defensively', async () => {
      // O filtro `not: null` já exclui nulos no banco; o `?? 0` só protege a
      // tipagem — força o caso para garantir que nunca vaza `null`.
      vi.spyOn(prisma.whatsAppMessage, 'findMany').mockResolvedValueOnce([
        { sentimentScore: null },
      ] as never)
      expect(
        expectOk(
          await WhatsAppMessageRepository.listRecentSentimentScores('c', 1),
        ),
      ).toEqual([0])
    })
  })

  describe('findById() / update()', () => {
    it('should find and update a message', async () => {
      const { workspace, conversation } = await seedConversation()
      const message = expectOk(
        await WhatsAppMessageRepository.create({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: 'OUT',
          type: 'TEXT',
          text: 'Oi',
        }),
      )

      expect(
        expectOk(await WhatsAppMessageRepository.findById(message.id))?.text,
      ).toBe('Oi')
      expect(
        expectOk(await WhatsAppMessageRepository.findById('missing')),
      ).toBeNull()

      const updated = expectOk(
        await WhatsAppMessageRepository.update(message.id, { text: 'Editada' }),
      )
      expect(updated.text).toBe('Editada')
    })

    it('should return DATABASE_ERROR for invalid writes', async () => {
      expectErr(
        await WhatsAppMessageRepository.update('missing', { text: 'x' }),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppMessageRepository.create({
          workspaceId: 'missing',
          conversationId: 'missing',
          direction: 'IN',
          type: 'TEXT',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('updateReactionByProviderMessageId()', () => {
    it('should set and clear a reaction', async () => {
      const { workspace, conversation } = await seedConversation()
      await WhatsAppMessageRepository.create({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Oi',
        providerMessageId: 'wamid.react',
      })

      const reacted = expectOk(
        await WhatsAppMessageRepository.updateReactionByProviderMessageId(
          'wamid.react',
          { emoji: '👍', reactedByContact: true },
        ),
      )
      expect(reacted?.reactionEmoji).toBe('👍')
      expect(reacted?.reactedByContact).toBe(true)

      const cleared = expectOk(
        await WhatsAppMessageRepository.updateReactionByProviderMessageId(
          'wamid.react',
          { emoji: '', reactedByContact: true },
        ),
      )
      expect(cleared?.reactionEmoji).toBeNull()
      expect(cleared?.reactedByContact).toBeNull()
    })

    it('should return null for an unknown providerMessageId', async () => {
      expect(
        expectOk(
          await WhatsAppMessageRepository.updateReactionByProviderMessageId(
            'never-existed',
            { emoji: '👍', reactedByContact: false },
          ),
        ),
      ).toBeNull()
    })
  })

  describe('query failures', () => {
    it('should map thrown reads to DATABASE_ERROR', async () => {
      const message = prisma.whatsAppMessage
      vi.spyOn(message, 'findMany')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(message, 'findUnique')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))

      expectErr(
        await WhatsAppMessageRepository.listByConversation('c', { limit: 1 }),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppMessageRepository.listLatestByConversation('c', 1),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppMessageRepository.listRecentSentimentScores('c', 1),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppMessageRepository.findByProviderMessageId('p'),
        'DATABASE_ERROR',
      )
      expectErr(await WhatsAppMessageRepository.findById('m'), 'DATABASE_ERROR')
      expectErr(
        await WhatsAppMessageRepository.updateStatusByProviderMessageId(
          'p',
          'READ',
        ),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppMessageRepository.updateReactionByProviderMessageId('p', {
          emoji: null,
          reactedByContact: false,
        }),
        'DATABASE_ERROR',
      )
    })
  })
})
