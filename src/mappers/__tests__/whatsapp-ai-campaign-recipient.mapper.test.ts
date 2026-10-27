import { describe, expect, it } from 'vitest'
import { toWhatsAppAiCampaignRecipientDTO } from '@/src/mappers/whatsapp-ai-campaign.mapper'
import type { WhatsAppAiCampaignRecipientRow } from '@/src/repositories/whatsapp-ai-campaign.repository'

describe('toWhatsAppAiCampaignRecipientDTO', () => {
  it('maps the contact insertion date next to the phone', () => {
    const row = {
      id: 'r1',
      campaignId: 'cp1',
      contactId: 'c1',
      status: 'PENDING',
      errorMessage: null,
      values: { valor: '10' },
      sentAt: null,
      repliedAt: null,
      conversationId: null,
      createdAt: new Date('2026-10-27T13:00:00Z'),
      updatedAt: new Date('2026-10-27T13:00:00Z'),
      contact: {
        name: null,
        waId: '5511988887777',
        createdAt: new Date('2026-10-27T12:15:00Z'),
      },
      conversation: null,
    } as unknown as WhatsAppAiCampaignRecipientRow

    const dto = toWhatsAppAiCampaignRecipientDTO(row)

    expect(dto.waId).toBe('5511988887777')
    expect(dto.contactCreatedAt).toBe('2026-10-27T12:15:00.000Z')
    expect(dto.conversationStatus).toBeNull()
  })
})
