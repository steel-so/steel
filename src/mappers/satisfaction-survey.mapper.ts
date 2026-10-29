import type {
  SatisfactionSurvey,
  SatisfactionSurveyConfig,
} from '@prisma/client'
import { responseRate, summarizeScores } from '@/src/lib/survey/metrics'
import type { SurveyReportRow } from '@/src/repositories/satisfaction-survey.repository'
import type {
  SurveyConfigDTO,
  SurveyDTO,
  SurveyKindDTO,
  SurveyReportDTO,
  SurveyReportRowDTO,
} from '@/types/satisfaction-survey'

type ConfigTrigger = SurveyConfigDTO['trigger']

export function toSurveyDTO(row: SatisfactionSurvey): SurveyDTO {
  return {
    id: row.id,
    kind: row.kind,
    trigger: row.trigger,
    channel: row.channel,
    status: row.status,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    recipientName: row.recipientName,
    customerName: row.customerName,
    assigneeName: row.assigneeName,
    teamName: row.teamName,
    score: row.score,
    comment: row.comment,
    failureReason: row.failureReason,
    sentAt: row.sentAt?.toISOString() ?? null,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The rule of a trigger; a workspace that never saved one reads the defaults. */
export function toSurveyConfigDTO(
  trigger: ConfigTrigger,
  row: SatisfactionSurveyConfig | null,
): SurveyConfigDTO {
  return {
    trigger,
    kind: row?.kind ?? 'CSAT',
    enabled: row?.enabled ?? false,
    delayMinutes: row?.delayMinutes ?? 5,
    expiresInHours: row?.expiresInHours ?? 72,
    cooldownDays: row?.cooldownDays ?? 30,
    emailFallback: row?.emailFallback ?? true,
    questionText: row?.questionText ?? null,
    thankYouText: row?.thankYouText ?? null,
  }
}

type GroupBy = SurveyReportDTO['groupBy']

const EMPTY_LABEL: Record<GroupBy, string> = {
  agent: 'Sem atendente',
  team: 'Sem equipe',
  technician: 'Sem técnico',
  customer: 'Sem cliente',
}

function groupKey(
  groupBy: GroupBy,
  row: SurveyReportRow,
): { key: string; name: string } | null {
  switch (groupBy) {
    case 'agent':
      // Conversation (and manual) surveys: the agent. Tickets have technicians.
      if (row.trigger === 'TICKET_RESOLVED') return null
      return { key: row.assigneeUserId ?? '', name: row.assigneeName ?? '' }
    case 'technician':
      if (row.trigger !== 'TICKET_RESOLVED') return null
      return { key: row.assigneeUserId ?? '', name: row.assigneeName ?? '' }
    case 'team':
      return { key: row.teamId ?? '', name: row.teamName ?? '' }
    case 'customer':
      return { key: row.customerKey ?? '', name: row.customerName ?? '' }
  }
}

function toRow(
  kind: SurveyKindDTO,
  key: string,
  name: string,
  rows: SurveyReportRow[],
): SurveyReportRowDTO {
  const answered = rows.filter(
    (r) => r.status === 'ANSWERED' && r.score !== null,
  )
  const metrics = summarizeScores(
    kind,
    answered.map((r) => ({ score: r.score as number })),
  )
  return {
    key,
    name,
    sent: rows.length,
    answered: metrics.answered,
    responseRate: responseRate(rows.length, metrics.answered),
    average: metrics.average,
    nps: metrics.nps,
    csat: metrics.csat,
    ces: metrics.ces,
    promoters: metrics.promoters,
    passives: metrics.passives,
    detractors: metrics.detractors,
  }
}

/**
 * Report of one kind grouped by agent / team / technician / customer. `sent`
 * counts every delivered invitation (answered or not), so the response rate is
 * meaningful; the score metrics only look at the answers. Best average first.
 */
export function buildSurveyReport(input: {
  kind: SurveyKindDTO
  groupBy: GroupBy
  rows: SurveyReportRow[]
  from: Date | null
  to: Date | null
}): SurveyReportDTO {
  const { kind, groupBy, rows } = input
  const buckets = new Map<string, { name: string; rows: SurveyReportRow[] }>()
  const scoped: SurveyReportRow[] = []
  for (const row of rows) {
    const group = groupKey(groupBy, row)
    if (!group) continue
    scoped.push(row)
    const key = group.key || 'none'
    const bucket = buckets.get(key) ?? {
      name: group.key ? group.name || group.key : EMPTY_LABEL[groupBy],
      rows: [],
    }
    bucket.rows.push(row)
    buckets.set(key, bucket)
  }

  const result = [...buckets.entries()].map(([key, bucket]) =>
    toRow(kind, key, bucket.name, bucket.rows),
  )
  result.sort(
    (a, b) => (b.average ?? -1) - (a.average ?? -1) || b.answered - a.answered,
  )

  return {
    kind,
    groupBy,
    from: input.from?.toISOString() ?? null,
    to: input.to?.toISOString() ?? null,
    total: toRow(kind, 'total', 'Total', scoped),
    rows: result,
  }
}
