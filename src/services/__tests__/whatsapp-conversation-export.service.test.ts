import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppConversationService } from '../whatsapp-conversation.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)

function asRole(role: 'MEMBER' | 'VIEWER' | 'ADMIN') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

describe('WhatsAppConversationService.exportTranscript()', () => {
  it('should export the messages after the last clear and audit it', async () => {
    asRole('ADMIN')
    const clearedAt = new Date('2026-10-01T00:00:00Z')
    mockedConversationRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          workspaceId: 'ws1',
          clearedAt,
          contact: createFakeWhatsAppContact({
            name: 'Maria',
            waId: '5511999990000',
          }),
        }),
      ),
    )
    mockedMessageRepo.listForExport.mockResolvedValue(
      ok([
        {
          ...createFakeWhatsAppMessage({ text: 'Bom dia' }),
          senderUser: null,
        },
        {
          ...createFakeWhatsAppMessage({ direction: 'OUT', text: 'Olá' }),
          senderUser: { name: 'Ana' },
        },
      ]),
    )

    const file = expectOk(
      await WhatsAppConversationService.exportTranscript(
        'u1',
        'ws1',
        'conv1',
        'txt',
      ),
    )

    expect(mockedMessageRepo.listForExport).toHaveBeenCalledWith('conv1', {
      limit: expect.any(Number),
      after: clearedAt,
    })
    expect(file.fileName).toBe('conversa-maria.txt')
    expect(file.body).toContain('Maria: Bom dia')
    expect(file.body).toContain('Ana: Olá')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_conversation',
        action: 'download',
        targetId: 'conv1',
        meta: { workspaceId: 'ws1', format: 'txt', messages: 2 },
      }),
    )
  })

  it('should answer not found for a deleted conversation', async () => {
    asRole('ADMIN')
    mockedConversationRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          workspaceId: 'ws1',
          deletedAt: new Date(),
        }),
      ),
    )

    expectErr(
      await WhatsAppConversationService.exportTranscript(
        'u1',
        'ws1',
        'conv1',
        'csv',
      ),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  describe('pdf', () => {
    function arrangePdf(messageCount: number) {
      asRole('ADMIN')
      mockedConversationRepo.findById.mockResolvedValue(
        ok(
          createFakeWhatsAppConversationWithPreview({
            id: 'conv1',
            workspaceId: 'ws1',
            contact: createFakeWhatsAppContact({
              name: 'Maria',
              waId: '5511999990000',
            }),
          }),
        ),
      )
      mockedMessageRepo.listForExport.mockResolvedValue(
        ok(
          Array.from({ length: messageCount }, (_, i) => ({
            ...createFakeWhatsAppMessage({ text: `Mensagem ${i}` }),
            senderUser: null,
          })),
        ),
      )
    }

    it('should render a real PDF and audit it', async () => {
      arrangePdf(2)

      const file = expectOk(
        await WhatsAppConversationService.exportTranscript(
          'u1',
          'ws1',
          'conv1',
          'pdf',
        ),
      )

      expect(file.fileName).toBe('conversa-maria.pdf')
      expect(file.contentType).toBe('application/pdf')
      expect(file.body).toBeInstanceOf(Uint8Array)
      expect(
        Buffer.from(file.body as Uint8Array)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-')
      expect(mockedMessageRepo.listForExport).toHaveBeenCalledWith('conv1', {
        limit: 2001,
        after: null,
      })
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'download',
          meta: { workspaceId: 'ws1', format: 'pdf', messages: 2 },
        }),
      )
    })

    it('should refuse a conversation too long for a PDF, pointing to txt/csv', async () => {
      arrangePdf(2001)

      const error = expectErr(
        await WhatsAppConversationService.exportTranscript(
          'u1',
          'ws1',
          'conv1',
          'pdf',
        ),
        'VALIDATION_ERROR',
      )

      expect(error.message).toMatch(/\.txt/)
    })

    it('should accept a conversation exactly at the PDF cap', async () => {
      arrangePdf(2000)

      expectOk(
        await WhatsAppConversationService.exportTranscript(
          'u1',
          'ws1',
          'conv1',
          'pdf',
        ),
      )
    }, 60_000)
  })
})
