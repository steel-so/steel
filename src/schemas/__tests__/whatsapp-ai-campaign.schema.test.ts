import { describe, expect, it } from 'vitest'
import { AI_CAMPAIGN_PRESETS } from '@/src/lib/whatsapp/ai-campaign-presets'
import {
  AI_CAMPAIGN_ACTION_KINDS,
  AiCampaignActionsSchema,
  AiCampaignVariablesSchema,
  QueueWhatsAppAiCampaignSchema,
  UpdateWhatsAppAiCampaignSchema,
} from '../whatsapp-ai-campaign.schema'

describe('UpdateWhatsAppAiCampaignSchema', () => {
  it('should accept the aggressiveness from 20 to 60 seconds only', () => {
    expect(
      UpdateWhatsAppAiCampaignSchema.safeParse({ intervalSeconds: 20 }).success,
    ).toBe(true)
    expect(
      UpdateWhatsAppAiCampaignSchema.safeParse({ intervalSeconds: 60 }).success,
    ).toBe(true)
    expect(
      UpdateWhatsAppAiCampaignSchema.safeParse({ intervalSeconds: 19 }).success,
    ).toBe(false)
    expect(
      UpdateWhatsAppAiCampaignSchema.safeParse({ intervalSeconds: 61 }).success,
    ).toBe(false)
  })

  it('should reject an empty update', () => {
    expect(UpdateWhatsAppAiCampaignSchema.safeParse({}).success).toBe(false)
  })
})

describe('AiCampaignVariablesSchema', () => {
  it('should accept fixed, contact and column sources', () => {
    expect(
      AiCampaignVariablesSchema.safeParse({
        body: {
          '1': { source: 'CONTACT', field: 'FIRST_NAME', fallback: 'cliente' },
          '2': { source: 'COLUMN', column: 'valor' },
          '3': { source: 'FIXED', value: 'amanhã' },
        },
      }).success,
    ).toBe(true)
  })

  it('should reject an empty fixed text', () => {
    expect(
      AiCampaignVariablesSchema.safeParse({
        body: { '1': { source: 'FIXED', value: '  ' } },
      }).success,
    ).toBe(false)
  })
})

describe('AiCampaignActionsSchema', () => {
  it('should require HTTPS for webhooks and the destination of each action', () => {
    expect(
      AiCampaignActionsSchema.safeParse([
        {
          id: 'a1',
          kind: 'WEBHOOK',
          label: 'Hook',
          when: 'sempre',
          url: 'http://insecure.example.com',
        },
      ]).success,
    ).toBe(false)
    expect(
      AiCampaignActionsSchema.safeParse([
        { id: 'a1', kind: 'TRANSFER_USER', label: 'X', when: 'sempre' },
      ]).success,
    ).toBe(false)
  })

  it('should reject duplicated ids and badly named webhook fields', () => {
    const action = { id: 'a1', kind: 'OPT_OUT', label: 'Sair', when: 'pediu' }
    expect(AiCampaignActionsSchema.safeParse([action, action]).success).toBe(
      false,
    )
    expect(
      AiCampaignActionsSchema.safeParse([
        {
          id: 'a2',
          kind: 'WEBHOOK',
          label: 'Hook',
          when: 'sempre',
          url: 'https://x.example.com',
          fields: [{ key: 'Data Escolhida', description: 'data' }],
        },
      ]).success,
    ).toBe(false)
  })
})

describe('QueueWhatsAppAiCampaignSchema', () => {
  it('should take exactly one way of picking contacts', () => {
    expect(QueueWhatsAppAiCampaignSchema.safeParse({ all: true }).success).toBe(
      true,
    )
    expect(
      QueueWhatsAppAiCampaignSchema.safeParse({
        rows: [{ phone: '5511999990000', values: { valor: '10' } }],
      }).success,
    ).toBe(true)
    expect(
      QueueWhatsAppAiCampaignSchema.safeParse({
        all: true,
        contactIds: ['c1'],
      }).success,
    ).toBe(false)
    expect(QueueWhatsAppAiCampaignSchema.safeParse({}).success).toBe(false)
  })
})

describe('AI_CAMPAIGN_PRESETS', () => {
  it('should only suggest known action kinds, with the hours of each follow-up', () => {
    for (const preset of AI_CAMPAIGN_PRESETS) {
      expect(preset.actions.length).toBeGreaterThan(0)
      for (const action of preset.actions) {
        expect(AI_CAMPAIGN_ACTION_KINDS).toContain(action.kind)
        if (action.kind === 'FOLLOW_UP')
          expect(action.delayHours).toBeGreaterThan(0)
        if (action.kind === 'WEBHOOK')
          expect(action.fields?.length).toBeGreaterThan(0)
      }
    }
    expect(new Set(AI_CAMPAIGN_PRESETS.map((preset) => preset.id)).size).toBe(
      AI_CAMPAIGN_PRESETS.length,
    )
  })
})

describe('AiCampaignActionsSchema · SEND_PIX', () => {
  const base = {
    id: 'p1',
    kind: 'SEND_PIX',
    label: 'Cobrar adesão',
    when: 'O cliente aceitou',
  }

  it('should accept a fixed amount and description, rounding to the cent', () => {
    const parsed = AiCampaignActionsSchema.parse([
      { ...base, amount: 99.999, description: ' Taxa de adesão ' },
    ])
    expect(parsed[0]).toMatchObject({
      kind: 'SEND_PIX',
      amount: 100,
      description: 'Taxa de adesão',
    })
    expect(AI_CAMPAIGN_ACTION_KINDS).toContain('SEND_PIX')
  })

  it('should refuse a missing, tiny or huge amount and a bad description', () => {
    for (const patch of [
      { description: 'x' },
      { amount: 0, description: 'x' },
      { amount: 1_000_000, description: 'x' },
      { amount: 10, description: '  ' },
      { amount: 10, description: 'a'.repeat(141) },
    ]) {
      expect(
        AiCampaignActionsSchema.safeParse([{ ...base, ...patch }]).success,
      ).toBe(false)
    }
  })
})
