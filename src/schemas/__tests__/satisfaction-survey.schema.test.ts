import { describe, expect, it } from 'vitest'
import {
  AnswerSurveySchema,
  SendSurveySchema,
  SurveyConfigTriggerSchema,
  SurveyListQuerySchema,
  SurveyReportQuerySchema,
  UpdateSurveyConfigSchema,
} from '../satisfaction-survey.schema'

describe('satisfaction survey schemas', () => {
  it('accepts a partial config update and bounds the numbers', () => {
    expect(UpdateSurveyConfigSchema.safeParse({ enabled: true }).success).toBe(
      true,
    )
    expect(
      UpdateSurveyConfigSchema.safeParse({ delayMinutes: -1 }).success,
    ).toBe(false)
    expect(
      UpdateSurveyConfigSchema.safeParse({ delayMinutes: 1441 }).success,
    ).toBe(false)
    expect(
      UpdateSurveyConfigSchema.safeParse({ expiresInHours: 0 }).success,
    ).toBe(false)
    expect(
      UpdateSurveyConfigSchema.safeParse({ cooldownDays: 366 }).success,
    ).toBe(false)
    expect(
      UpdateSurveyConfigSchema.safeParse({ questionText: 'x'.repeat(601) })
        .success,
    ).toBe(false)
    expect(
      UpdateSurveyConfigSchema.safeParse({ questionText: null }).success,
    ).toBe(true)
  })

  it('only configurable triggers pass', () => {
    expect(SurveyConfigTriggerSchema.safeParse('MANUAL').success).toBe(false)
    expect(SurveyConfigTriggerSchema.safeParse('TICKET_RESOLVED').success).toBe(
      true,
    )
  })

  it('needs a contact or an e-mail to send manually', () => {
    expect(SendSurveySchema.safeParse({ kind: 'NPS' }).success).toBe(false)
    expect(
      SendSurveySchema.safeParse({ kind: 'NPS', email: 'nao-e-email' }).success,
    ).toBe(false)
    expect(
      SendSurveySchema.safeParse({ kind: 'NPS', email: 'a@b.com' }).success,
    ).toBe(true)
    expect(
      SendSurveySchema.safeParse({ kind: 'CSAT', whatsappContactId: 'c1' })
        .success,
    ).toBe(true)
  })

  it('validates an answer and drops an empty comment', () => {
    expect(AnswerSurveySchema.safeParse({ score: 11 }).success).toBe(false)
    expect(AnswerSurveySchema.safeParse({ score: 1.5 }).success).toBe(false)
    const parsed = AnswerSurveySchema.parse({ score: 4, comment: '  ' })
    expect(parsed.comment).toBeUndefined()
  })

  it('applies query defaults', () => {
    expect(SurveyReportQuerySchema.parse({})).toMatchObject({
      kind: 'CSAT',
      groupBy: 'agent',
    })
    expect(SurveyListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
    })
    expect(SurveyListQuerySchema.safeParse({ pageSize: 500 }).success).toBe(
      false,
    )
  })
})
