import { describe, expect, it } from 'vitest'
import type { WhatsAppContactBlockWithRefs } from '@/src/repositories/whatsapp-contact-block.repository'
import { toWhatsAppContactBlockDTO } from '../whatsapp-contact-block.mapper'

const NOW = new Date('2026-11-12T15:00:00.000Z')

function row(
  overrides: Partial<WhatsAppContactBlockWithRefs> = {},
): WhatsAppContactBlockWithRefs {
  return {
    id: 'blk1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    contactId: 'ct1',
    waId: '5511988887777',
    reason: 'Spam',
    providerStatus: 'APPLIED',
    providerError: null,
    appliedAt: NOW,
    lastAttemptAt: NOW,
    origin: 'STEEL',
    droppedCount: 3,
    lastDroppedAt: NOW,
    blockedById: 'u1',
    blockedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    connection: {
      id: 'conn1',
      label: 'Oficial',
      phoneNumber: '551130000000',
      provider: 'META',
    },
    contact: { id: 'ct1', name: 'Maria' },
    ...overrides,
  }
}

describe('toWhatsAppContactBlockDTO', () => {
  it('maps a block with its number, contact and who blocked', () => {
    expect(toWhatsAppContactBlockDTO(row(), new Map([['u1', 'Ana']]))).toEqual({
      id: 'blk1',
      connectionId: 'conn1',
      connectionLabel: 'Oficial',
      connectionPhoneNumber: '551130000000',
      provider: 'META',
      contactId: 'ct1',
      contactName: 'Maria',
      waId: '5511988887777',
      hasPhone: true,
      reason: 'Spam',
      providerStatus: 'APPLIED',
      providerError: null,
      appliedAt: NOW.toISOString(),
      origin: 'STEEL',
      droppedCount: 3,
      lastDroppedAt: NOW.toISOString(),
      blockedBy: { id: 'u1', name: 'Ana' },
      blockedAt: NOW.toISOString(),
    })
  })

  it('handles an imported block of a BSUID with no contact nor blocker', () => {
    const dto = toWhatsAppContactBlockDTO(
      row({
        waId: 'BR.123',
        contactId: null,
        contact: null,
        blockedById: null,
        origin: 'PROVIDER',
        providerStatus: 'PENDING',
        providerError: 'Aguardando',
        appliedAt: null,
        lastDroppedAt: null,
      }),
    )
    expect(dto).toMatchObject({
      contactId: null,
      contactName: null,
      hasPhone: false,
      blockedBy: null,
      origin: 'PROVIDER',
      providerStatus: 'PENDING',
      providerError: 'Aguardando',
      appliedAt: null,
      lastDroppedAt: null,
    })
  })

  it('drops the blocker when the member is gone', () => {
    expect(toWhatsAppContactBlockDTO(row(), new Map()).blockedBy).toBeNull()
  })
})
