import { describe, expect, it } from 'vitest'
import {
  createFakeSurvey,
  createFakeSurveyConfig,
} from '@/src/__tests__/factories/nov-t1-nps.factory'
import {
  buildSurveyReport,
  toSurveyConfigDTO,
  toSurveyDTO,
} from '../satisfaction-survey.mapper'

const row = (o: Record<string, unknown>) => ({
  status: 'ANSWERED' as const,
  score: 5,
  assigneeUserId: 'u1',
  assigneeName: 'Carlos',
  teamId: 't1',
  teamName: 'Suporte',
  customerKey: 'k1',
  customerName: 'Acme',
  trigger: 'CONVERSATION_CLOSED' as const,
  ...o,
})

describe('toSurveyDTO()', () => {
  it('serializes dates and drops internals', () => {
    const dto = toSurveyDTO(
      createFakeSurvey({ answeredAt: new Date('2026-11-03T13:00:00Z') }),
    )
    expect(dto.answeredAt).toBe('2026-11-03T13:00:00.000Z')
    expect(dto).not.toHaveProperty('token')
    expect(dto).not.toHaveProperty('recipientPhone')
  })

  it('keeps null dates null', () => {
    const dto = toSurveyDTO(createFakeSurvey({ sentAt: null }))
    expect(dto.sentAt).toBeNull()
    expect(dto.answeredAt).toBeNull()
  })
})

describe('toSurveyConfigDTO()', () => {
  it('reads defaults when nothing was saved', () => {
    const dto = toSurveyConfigDTO('TICKET_RESOLVED', null)
    expect(dto).toMatchObject({
      trigger: 'TICKET_RESOLVED',
      enabled: false,
      kind: 'CSAT',
      delayMinutes: 5,
      cooldownDays: 30,
      emailFallback: true,
      questionText: null,
    })
  })

  it('reads the saved rule', () => {
    const dto = toSurveyConfigDTO(
      'CONVERSATION_CLOSED',
      createFakeSurveyConfig({ kind: 'NPS', questionText: 'Q', enabled: true }),
    )
    expect(dto).toMatchObject({ kind: 'NPS', questionText: 'Q', enabled: true })
  })
})

describe('buildSurveyReport()', () => {
  it('groups by agent, ignoring ticket surveys, with the response rate', () => {
    const report = buildSurveyReport({
      kind: 'CSAT',
      groupBy: 'agent',
      from: null,
      to: new Date('2026-11-30T00:00:00Z'),
      rows: [
        row({}),
        row({ score: 3 }),
        row({ status: 'SENT', score: null }),
        row({ assigneeUserId: 'u2', assigneeName: 'Bia', score: 4 }),
        row({ trigger: 'TICKET_RESOLVED' }),
        row({ assigneeUserId: null, assigneeName: null }),
      ],
    })
    expect(report.total.sent).toBe(5)
    const carlos = report.rows.find((r) => r.key === 'u1')
    expect(carlos).toMatchObject({
      sent: 3,
      answered: 2,
      average: 4,
      csat: 50,
    })
    expect(carlos?.responseRate).toBe(66.7)
    expect(report.rows.find((r) => r.key === 'none')?.name).toBe(
      'Sem atendente',
    )
    expect(report.rows[0].average).toBeGreaterThanOrEqual(
      report.rows[1].average ?? 0,
    )
    expect(report.to).toBe('2026-11-30T00:00:00.000Z')
    expect(report.from).toBeNull()
  })

  it('technician only counts ticket surveys', () => {
    const report = buildSurveyReport({
      kind: 'CSAT',
      groupBy: 'technician',
      from: null,
      to: null,
      rows: [row({}), row({ trigger: 'TICKET_RESOLVED' })],
    })
    expect(report.total.sent).toBe(1)
    expect(report.rows[0].name).toBe('Carlos')
  })

  it('groups by team and customer with empty labels', () => {
    const rows = [row({ teamId: null, teamName: null, customerKey: null })]
    expect(
      buildSurveyReport({
        kind: 'NPS',
        groupBy: 'team',
        from: null,
        to: null,
        rows,
      }).rows[0].name,
    ).toBe('Sem equipe')
    const byCustomer = buildSurveyReport({
      kind: 'CES',
      groupBy: 'customer',
      from: null,
      to: null,
      rows,
    })
    expect(byCustomer.rows[0].name).toBe('Sem cliente')
    expect(byCustomer.rows[0].ces).toBe(5)
  })

  it('falls back to the key when the name is empty', () => {
    const report = buildSurveyReport({
      kind: 'CSAT',
      groupBy: 'customer',
      from: null,
      to: null,
      rows: [row({ customerName: null })],
    })
    expect(report.rows[0].name).toBe('k1')
  })
})
