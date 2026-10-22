import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppSlaPolicySchema,
  UpdateWhatsAppSlaPolicySchema,
  WHATSAPP_SLA_MAX_MINUTES,
  WhatsAppSlaOpenQuerySchema,
  WhatsAppSlaReportQuerySchema,
} from '../whatsapp-sla.schema'

describe('CreateWhatsAppSlaPolicySchema', () => {
  it('should accept an empty body (everything defaults in the service)', () => {
    expect(CreateWhatsAppSlaPolicySchema.safeParse({}).success).toBe(true)
  })

  it('should accept a full policy for a team', () => {
    const parsed = CreateWhatsAppSlaPolicySchema.safeParse({
      teamId: 'team1',
      enabled: true,
      firstResponseMinutes: 10,
      resolutionMinutes: null,
      businessHoursOnly: false,
      warnAtPercent: 90,
      countAiAsResponse: true,
      notifyAssignee: false,
      notifyTeamLeaders: true,
      notifySupervisors: true,
      supervisorIds: ['u1'],
      notifyInApp: true,
      notifyEmail: true,
    })
    expect(parsed.success).toBe(true)
  })

  it.each([
    [{ firstResponseMinutes: 0 }, 'pelo menos 1 minuto'],
    [{ firstResponseMinutes: 1.5 }, 'número inteiro'],
    [
      { firstResponseMinutes: WHATSAPP_SLA_MAX_MINUTES + 1 },
      'no máximo 30 dias',
    ],
    [{ resolutionMinutes: 0 }, 'pelo menos 1 minuto'],
    [{ warnAtPercent: 5 }, 'pelo menos 10%'],
    [{ warnAtPercent: 100 }, 'no máximo 99%'],
    [{ warnAtPercent: 80.5 }, 'número inteiro'],
    [
      { supervisorIds: Array.from({ length: 21 }, (_, i) => `u${i}`) },
      'até 20',
    ],
  ])('should reject %j', (body, message) => {
    const parsed = CreateWhatsAppSlaPolicySchema.safeParse(body)
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain(message)
  })
})

describe('UpdateWhatsAppSlaPolicySchema', () => {
  it('should require at least one field', () => {
    const parsed = UpdateWhatsAppSlaPolicySchema.safeParse({})
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain('ao menos um campo')
  })

  it('should not let the scope (teamId) be changed', () => {
    const parsed = UpdateWhatsAppSlaPolicySchema.safeParse({
      teamId: 'other',
      enabled: true,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ enabled: true })
  })

  it('should accept a partial change', () => {
    expect(
      UpdateWhatsAppSlaPolicySchema.safeParse({ resolutionMinutes: null })
        .success,
    ).toBe(true)
  })
})

describe('WhatsAppSlaReportQuerySchema', () => {
  it('should accept dates, a team and a format', () => {
    expect(
      WhatsAppSlaReportQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-22',
        teamId: 't1',
        format: 'csv',
      }).success,
    ).toBe(true)
  })

  it('should reject an invalid date or format', () => {
    expect(
      WhatsAppSlaReportQuerySchema.safeParse({ from: 'ontem' }).success,
    ).toBe(false)
    expect(
      WhatsAppSlaReportQuerySchema.safeParse({ format: 'xlsx' }).success,
    ).toBe(false)
  })
})

describe('WhatsAppSlaOpenQuerySchema', () => {
  it('should accept the two states and nothing', () => {
    expect(WhatsAppSlaOpenQuerySchema.safeParse({}).success).toBe(true)
    expect(
      WhatsAppSlaOpenQuerySchema.safeParse({ state: 'AT_RISK' }).success,
    ).toBe(true)
    expect(WhatsAppSlaOpenQuerySchema.safeParse({ state: 'OK' }).success).toBe(
      false,
    )
  })
})
