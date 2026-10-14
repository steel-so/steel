import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { createFakeWhatsAppUsage } from '@/src/__tests__/factories/whatsapp-usage.factory'
import { toWhatsAppUsageDTO } from '../whatsapp-usage.mapper'

describe('toWhatsAppUsageDTO()', () => {
  it('should report zero usage and no limits when nothing was saved', () => {
    expect(
      toWhatsAppUsageDTO({
        workspaceId: 'ws1',
        period: '2026-10',
        usage: null,
        settings: null,
        canManage: false,
      }),
    ).toEqual({
      workspaceId: 'ws1',
      period: '2026-10',
      canManage: false,
      conversations: { used: 0, limit: null, percent: null, reached: false },
      messages: { used: 0, limit: null, percent: null, reached: false },
    })
  })

  it('should compute percentages and the reached flag per metric', () => {
    const dto = toWhatsAppUsageDTO({
      workspaceId: 'ws1',
      period: '2026-10',
      usage: createFakeWhatsAppUsage({
        conversations: 40,
        outboundMessages: 1200,
      }),
      settings: createFakeWhatsAppSettings({
        monthlyConversationLimit: 50,
        monthlyMessageLimit: 1000,
      }),
      canManage: true,
    })

    expect(dto.canManage).toBe(true)
    expect(dto.conversations).toEqual({
      used: 40,
      limit: 50,
      percent: 80,
      reached: false,
    })
    // Over the limit (a send in flight when it was lowered): capped at 100%.
    expect(dto.messages).toEqual({
      used: 1200,
      limit: 1000,
      percent: 100,
      reached: true,
    })
  })

  it('should round the percentage down to an integer', () => {
    const dto = toWhatsAppUsageDTO({
      workspaceId: 'ws1',
      period: '2026-10',
      usage: createFakeWhatsAppUsage({ conversations: 2 }),
      settings: createFakeWhatsAppSettings({ monthlyConversationLimit: 3 }),
      canManage: false,
    })
    expect(dto.conversations.percent).toBe(66)
  })
})
