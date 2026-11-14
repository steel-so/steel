import { describe, expect, it } from 'vitest'
import {
  ControlCrmCampaignSchema,
  CreateCrmCampaignSchema,
  CrmCampaignAudiencePreviewSchema,
  CrmCampaignAudienceSchema,
  CrmCampaignRefSchema,
  CrmCampaignTestSendSchema,
  CrmCampaignVariableSourceSchema,
  CrmCampaignWhatsAppVariablesSchema,
  LaunchCrmCampaignSchema,
  ListCrmCampaignRecipientsQuerySchema,
  ResendWebhookEventSchema,
  UpdateCrmCampaignSchema,
} from '../crm-campaign.schema'

describe('CreateCrmCampaignSchema', () => {
  it('should trim the name', () => {
    expect(CreateCrmCampaignSchema.parse({ name: '  Black Friday ' })).toEqual({
      name: 'Black Friday',
    })
  })

  it('should reject an empty name', () => {
    const result = CreateCrmCampaignSchema.safeParse({ name: '   ' })
    expect(result.success).toBe(false)
  })
})

describe('CrmCampaignAudienceSchema', () => {
  it('should default every source to empty', () => {
    expect(CrmCampaignAudienceSchema.parse({})).toEqual({
      mailingListIds: [],
      allPeople: false,
      leadStages: [],
    })
  })

  it('should reject an unknown lead stage', () => {
    const result = CrmCampaignAudienceSchema.safeParse({
      leadStages: ['WHATEVER'],
    })
    expect(result.success).toBe(false)
  })
})

describe('CrmCampaignVariableSourceSchema', () => {
  it('should accept the link source without value', () => {
    expect(
      CrmCampaignVariableSourceSchema.safeParse({ source: 'link' }).success,
    ).toBe(true)
  })

  it('should require a value for a static source', () => {
    expect(
      CrmCampaignVariableSourceSchema.safeParse({ source: 'static' }).success,
    ).toBe(false)
    expect(
      CrmCampaignVariableSourceSchema.safeParse({
        source: 'static',
        value: 'Oi',
      }).success,
    ).toBe(true)
  })
})

describe('CrmCampaignWhatsAppVariablesSchema', () => {
  it('should default the three maps and reject non-numeric keys', () => {
    expect(CrmCampaignWhatsAppVariablesSchema.parse({})).toEqual({
      header: {},
      body: {},
      buttons: {},
    })
    expect(
      CrmCampaignWhatsAppVariablesSchema.safeParse({
        body: { x: { source: 'name' } },
      }).success,
    ).toBe(false)
  })
})

describe('UpdateCrmCampaignSchema', () => {
  it('should accept a partial draft', () => {
    const result = UpdateCrmCampaignSchema.parse({
      emailSubject: 'Oferta',
      scheduledAt: '2026-11-01T12:00:00.000Z',
    })
    expect(result.emailSubject).toBe('Oferta')
    expect(result.scheduledAt).toBeInstanceOf(Date)
  })

  it('should allow clearing nullable fields', () => {
    const result = UpdateCrmCampaignSchema.parse({
      formId: null,
      whatsappVariables: null,
      scheduledAt: null,
    })
    expect(result.formId).toBeNull()
  })

  it('should reject an invalid sender and utm medium', () => {
    expect(
      UpdateCrmCampaignSchema.safeParse({ emailFrom: 'nope' }).success,
    ).toBe(false)
    expect(
      UpdateCrmCampaignSchema.safeParse({ utmMedium: 'com espaço' }).success,
    ).toBe(false)
  })

  it('should reject a send window that starts and ends at the same hour', () => {
    const result = UpdateCrmCampaignSchema.safeParse({
      sendWindowStartHour: 9,
      sendWindowEndHour: 9,
    })
    expect(result.success).toBe(false)
  })

  it('should accept a window crossing midnight', () => {
    expect(
      UpdateCrmCampaignSchema.safeParse({
        sendWindowStartHour: 22,
        sendWindowEndHour: 6,
      }).success,
    ).toBe(true)
  })

  it('should bound the WhatsApp delay', () => {
    expect(
      UpdateCrmCampaignSchema.safeParse({ whatsappDelayHours: 721 }).success,
    ).toBe(false)
  })
})

describe('LaunchCrmCampaignSchema', () => {
  it('should require the legal basis confirmation', () => {
    expect(LaunchCrmCampaignSchema.safeParse({}).success).toBe(false)
    expect(
      LaunchCrmCampaignSchema.safeParse({ confirmLegalBasis: false }).success,
    ).toBe(false)
    expect(
      LaunchCrmCampaignSchema.safeParse({ confirmLegalBasis: true }).success,
    ).toBe(true)
  })
})

describe('ControlCrmCampaignSchema', () => {
  it('should accept only the three actions', () => {
    expect(
      ControlCrmCampaignSchema.safeParse({ action: 'pause' }).success,
    ).toBe(true)
    expect(
      ControlCrmCampaignSchema.safeParse({ action: 'delete' }).success,
    ).toBe(false)
  })
})

describe('CrmCampaignAudiencePreviewSchema', () => {
  it('should default whatsappEnabled to false', () => {
    expect(
      CrmCampaignAudiencePreviewSchema.parse({ audience: {} }).whatsappEnabled,
    ).toBe(false)
  })
})

describe('CrmCampaignTestSendSchema', () => {
  it('should require an e-mail or a phone', () => {
    expect(CrmCampaignTestSendSchema.safeParse({}).success).toBe(false)
    expect(
      CrmCampaignTestSendSchema.safeParse({ email: 'a@example.com' }).success,
    ).toBe(true)
    expect(
      CrmCampaignTestSendSchema.safeParse({ phone: '11999990000' }).success,
    ).toBe(true)
  })
})

describe('ListCrmCampaignRecipientsQuerySchema', () => {
  it('should coerce and default pagination', () => {
    expect(ListCrmCampaignRecipientsQuerySchema.parse({ page: '2' })).toEqual({
      page: 2,
      pageSize: 25,
    })
  })
})

describe('CrmCampaignRefSchema', () => {
  it('should accept an empty ref and bound lengths', () => {
    expect(CrmCampaignRefSchema.safeParse({}).success).toBe(true)
    expect(
      CrmCampaignRefSchema.safeParse({ ref: 'x'.repeat(201) }).success,
    ).toBe(false)
  })
})

describe('ResendWebhookEventSchema', () => {
  it('should keep unknown data fields', () => {
    const event = ResendWebhookEventSchema.parse({
      type: 'email.delivered',
      data: { email_id: 'abc', to: ['a@example.com'] },
    })
    expect(event.data.email_id).toBe('abc')
    expect(event.data.to).toEqual(['a@example.com'])
  })
})
