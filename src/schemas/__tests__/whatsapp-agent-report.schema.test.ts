import { describe, expect, it } from 'vitest'
import {
  UpdateWhatsAppAgentReportSettingsSchema,
  WhatsAppAgentReportQuerySchema,
} from '@/src/schemas/whatsapp-agent-report.schema'

describe('WhatsAppAgentReportQuerySchema', () => {
  it('accepts an empty query (defaults live in the service)', () => {
    expect(WhatsAppAgentReportQuerySchema.parse({})).toEqual({})
  })

  it('accepts days, filters and the csv format', () => {
    expect(
      WhatsAppAgentReportQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-07',
        teamId: 't1',
        connectionId: 'c1',
        format: 'csv',
      }),
    ).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
      teamId: 't1',
      connectionId: 'c1',
      format: 'csv',
    })
  })

  it.each([
    ['2026-11-1', 'formato'],
    ['01/11/2026', 'formato'],
    ['2026-02-30', 'inválida'],
    ['2026-13-01', 'inválida'],
    ['2026-11-01T00:00:00Z', 'formato'],
  ])('rejects the day %s', (value, message) => {
    const result = WhatsAppAgentReportQuerySchema.safeParse({ from: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain(message)
  })

  it('rejects empty ids and unknown formats', () => {
    expect(
      WhatsAppAgentReportQuerySchema.safeParse({ teamId: '' }).success,
    ).toBe(false)
    expect(
      WhatsAppAgentReportQuerySchema.safeParse({ connectionId: '' }).success,
    ).toBe(false)
    expect(
      WhatsAppAgentReportQuerySchema.safeParse({ format: 'xlsx' }).success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppAgentReportSettingsSchema', () => {
  it('requires a boolean', () => {
    expect(
      UpdateWhatsAppAgentReportSettingsSchema.parse({ enabled: true }),
    ).toEqual({ enabled: true })
    expect(UpdateWhatsAppAgentReportSettingsSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      UpdateWhatsAppAgentReportSettingsSchema.safeParse({ enabled: 'yes' })
        .success,
    ).toBe(false)
  })
})
