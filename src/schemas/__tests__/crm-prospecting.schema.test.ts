import { describe, expect, it } from 'vitest'
import {
  CreateCrmProspectDraftSchema,
  CreateCrmProspectingAgentSchema,
  DecideCrmProspectDraftSchema,
  ListCrmProspectDraftsQuerySchema,
  PROSPECT_WHATSAPP_BODY_MAX,
  UpdateCrmProspectDraftSchema,
  UpdateCrmProspectingSettingsSchema,
} from '../crm-prospecting.schema'

const message = 'Olá, Ana. Vi que a Acme abriu vagas de TI e posso ajudar.'

describe('UpdateCrmProspectingSettingsSchema', () => {
  it('should accept a partial update and dedupe lists', () => {
    const parsed = UpdateCrmProspectingSettingsSchema.parse({
      enabled: true,
      allowedChannels: ['EMAIL', 'EMAIL'],
      signalKeywords: ['pabx', 'pabx', 'call center'],
    })
    expect(parsed.allowedChannels).toEqual(['EMAIL'])
    expect(parsed.signalKeywords).toEqual(['pabx', 'call center'])
  })

  it.each([
    [{}],
    [{ allowedChannels: [] }],
    [{ monthlyWebLimit: -1 }],
    [{ monthlyDraftLimit: 1.5 }],
    [{ signalKeywords: ['ab'] }],
    [{ valueProposition: 'x'.repeat(2001) }],
  ])('should reject %j', (input) => {
    expect(UpdateCrmProspectingSettingsSchema.safeParse(input).success).toBe(
      false,
    )
  })

  it('should allow clearing the value proposition', () => {
    expect(
      UpdateCrmProspectingSettingsSchema.parse({ valueProposition: null }),
    ).toEqual({ valueProposition: null })
  })
})

describe('CreateCrmProspectDraftSchema', () => {
  const email = {
    leadId: 'lead1',
    channel: 'EMAIL' as const,
    subject: 'Uma ideia',
    body: message,
  }

  it('should accept an e-mail draft and default the lists', () => {
    const parsed = CreateCrmProspectDraftSchema.parse(email)
    expect(parsed.signals).toEqual([])
    expect(parsed.sources).toEqual([])
  })

  it('should accept signals and sources', () => {
    const parsed = CreateCrmProspectDraftSchema.parse({
      ...email,
      signals: [
        {
          type: 'HIRING',
          evidence: 'Estamos contratando',
          sourceUrl: 'https://acme.com.br/vagas',
        },
      ],
      sources: [{ url: 'https://acme.com.br/vagas', title: 'Vagas' }],
    })
    expect(parsed.signals).toHaveLength(1)
  })

  it('should require a target record', () => {
    const result = CreateCrmProspectDraftSchema.safeParse({
      ...email,
      leadId: undefined,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['leadId'])
  })

  it('should accept a person or a company as the only target', () => {
    for (const target of [{ personId: 'p1' }, { companyId: 'c1' }]) {
      expect(
        CreateCrmProspectDraftSchema.safeParse({
          ...email,
          leadId: undefined,
          ...target,
        }).success,
      ).toBe(true)
    }
  })

  it('should require a subject for e-mail but not for WhatsApp', () => {
    expect(
      CreateCrmProspectDraftSchema.safeParse({ ...email, subject: undefined })
        .success,
    ).toBe(false)
    expect(
      CreateCrmProspectDraftSchema.safeParse({
        ...email,
        channel: 'WHATSAPP',
        subject: undefined,
      }).success,
    ).toBe(true)
  })

  it('should cap a WhatsApp message and accept a long e-mail', () => {
    const long = 'a'.repeat(PROSPECT_WHATSAPP_BODY_MAX + 1)
    expect(
      CreateCrmProspectDraftSchema.safeParse({
        ...email,
        channel: 'WHATSAPP',
        body: long,
      }).success,
    ).toBe(false)
    expect(
      CreateCrmProspectDraftSchema.safeParse({ ...email, body: long }).success,
    ).toBe(true)
  })

  it.each([
    [{ body: 'curto' }],
    [{ toEmail: 'not-an-email' }],
    [{ signals: [{ type: 'MAGIC', evidence: 'xxx' }] }],
    [{ signals: [{ type: 'HIRING', evidence: 'x' }] }],
    [{ sources: [{ url: 'nao-e-url' }] }],
  ])('should reject %j', (patch) => {
    expect(
      CreateCrmProspectDraftSchema.safeParse({ ...email, ...patch }).success,
    ).toBe(false)
  })
})

describe('UpdateCrmProspectDraftSchema', () => {
  it('should accept a partial edit and reject an empty one', () => {
    expect(UpdateCrmProspectDraftSchema.parse({ body: message })).toEqual({
      body: message,
    })
    expect(UpdateCrmProspectDraftSchema.safeParse({}).success).toBe(false)
    expect(UpdateCrmProspectDraftSchema.safeParse({ body: 'x' }).success).toBe(
      false,
    )
  })
})

describe('ListCrmProspectDraftsQuerySchema', () => {
  it('should default the limit and coerce it', () => {
    expect(ListCrmProspectDraftsQuerySchema.parse({}).limit).toBe(50)
    expect(ListCrmProspectDraftsQuerySchema.parse({ limit: '10' }).limit).toBe(
      10,
    )
  })

  it('should reject an unknown status and a huge limit', () => {
    expect(
      ListCrmProspectDraftsQuerySchema.safeParse({ status: 'DONE' }).success,
    ).toBe(false)
    expect(
      ListCrmProspectDraftsQuerySchema.safeParse({ limit: 500 }).success,
    ).toBe(false)
  })
})

describe('DecideCrmProspectDraftSchema', () => {
  it('should accept approve and mark-sent without a reason', () => {
    for (const decision of ['APPROVE', 'MARK_SENT'] as const) {
      expect(DecideCrmProspectDraftSchema.safeParse({ decision }).success).toBe(
        true,
      )
    }
  })

  it('should require a reason to reject', () => {
    const result = DecideCrmProspectDraftSchema.safeParse({
      decision: 'REJECT',
    })
    expect(result.success).toBe(false)
    expect(
      DecideCrmProspectDraftSchema.safeParse({
        decision: 'REJECT',
        reason: 'Fora do perfil',
      }).success,
    ).toBe(true)
  })
})

describe('CreateCrmProspectingAgentSchema', () => {
  it('should default to the assignment trigger', () => {
    expect(CreateCrmProspectingAgentSchema.parse({})).toEqual({
      trigger: 'ASSIGNMENT',
    })
    expect(
      CreateCrmProspectingAgentSchema.safeParse({ trigger: 'CRON' }).success,
    ).toBe(false)
  })
})
