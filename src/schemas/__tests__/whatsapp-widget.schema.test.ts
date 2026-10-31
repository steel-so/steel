import { describe, expect, it } from 'vitest'
import {
  UpdateWhatsAppWidgetSettingsSchema,
  WidgetKeyQuerySchema,
  WidgetMessagesQuerySchema,
  WidgetSendMessageSchema,
  WidgetSurveyAnswerSchema,
} from '../whatsapp-widget.schema'

describe('UpdateWhatsAppWidgetSettingsSchema', () => {
  it('should accept an empty patch', () => {
    expect(UpdateWhatsAppWidgetSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('should normalize and de-duplicate the allowed origins', () => {
    const parsed = UpdateWhatsAppWidgetSettingsSchema.parse({
      allowedOrigins: [
        'HTTPS://Site.com.br/home',
        'https://site.com.br',
        'https://*.loja.com.br',
      ],
    })
    expect(parsed.allowedOrigins).toEqual([
      'https://site.com.br',
      'https://*.loja.com.br',
    ])
  })

  it('should reject an entry that is not an https address', () => {
    const parsed = UpdateWhatsAppWidgetSettingsSchema.safeParse({
      allowedOrigins: ['site.com.br'],
    })
    expect(parsed.success).toBe(false)
  })

  it('should limit the number of origins', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://s${i}.com`)
    expect(
      UpdateWhatsAppWidgetSettingsSchema.safeParse({ allowedOrigins: many })
        .success,
    ).toBe(false)
  })

  it('should validate color, position and texts', () => {
    expect(
      UpdateWhatsAppWidgetSettingsSchema.safeParse({ accentColor: 'blue' })
        .success,
    ).toBe(false)
    expect(
      UpdateWhatsAppWidgetSettingsSchema.safeParse({ position: 'TOP' }).success,
    ).toBe(false)
    expect(
      UpdateWhatsAppWidgetSettingsSchema.safeParse({ title: '  ' }).success,
    ).toBe(false)
    expect(
      UpdateWhatsAppWidgetSettingsSchema.safeParse({
        accentColor: '#0A1b2C',
        position: 'LEFT',
        teamId: null,
        enabled: true,
      }).success,
    ).toBe(true)
  })
})

describe('public widget schemas', () => {
  it('should require a key', () => {
    expect(WidgetKeyQuerySchema.safeParse({}).success).toBe(false)
    expect(WidgetKeyQuerySchema.safeParse({ key: 'stw_a' }).success).toBe(true)
  })

  it('should accept an ISO cursor only', () => {
    expect(
      WidgetMessagesQuerySchema.safeParse({
        key: 'k',
        after: '2026-10-30T12:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      WidgetMessagesQuerySchema.safeParse({ key: 'k', after: 'yesterday' })
        .success,
    ).toBe(false)
  })

  it('should trim and bound the message', () => {
    expect(WidgetSendMessageSchema.parse({ text: '  oi  ' }).text).toBe('oi')
    expect(WidgetSendMessageSchema.safeParse({ text: '   ' }).success).toBe(
      false,
    )
    expect(
      WidgetSendMessageSchema.safeParse({ text: 'a'.repeat(2001) }).success,
    ).toBe(false)
    expect(
      WidgetSendMessageSchema.safeParse({ text: 'oi', email: 'nope' }).success,
    ).toBe(false)
  })

  it('should bound the survey score', () => {
    expect(WidgetSurveyAnswerSchema.safeParse({ score: 10 }).success).toBe(true)
    expect(WidgetSurveyAnswerSchema.safeParse({ score: 11 }).success).toBe(
      false,
    )
    expect(WidgetSurveyAnswerSchema.safeParse({ score: 1.5 }).success).toBe(
      false,
    )
  })
})
