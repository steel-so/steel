import { z } from 'zod'
import { dto } from './../common'

/**
 * Schemas de resposta das pesquisas NPS/CSAT/CES (`types/satisfaction-survey.d.ts`).
 * Mantenha alinhados a `src/mappers/satisfaction-survey.mapper.ts`.
 */

const kind = z
  .enum(['NPS', 'CSAT', 'CES'])
  .meta({ description: 'NPS 0–10, CSAT 1–5, CES 1–7.' })
const nullableDateTime = () => z.iso.datetime().nullable()

export const SurveyConfigDTO = dto(
  'SatisfactionSurveyConfig',
  z.object({
    trigger: z.enum(['CONVERSATION_CLOSED', 'TICKET_RESOLVED']),
    kind,
    enabled: z
      .boolean()
      .meta({ description: 'Desligada por padrão: nada é enviado até ligar.' }),
    delayMinutes: z.number().int(),
    expiresInHours: z.number().int(),
    cooldownDays: z.number().int(),
    emailFallback: z.boolean(),
    alertDetractors: z.boolean().meta({
      description:
        'Avisa os administradores quando chega uma resposta de detrator.',
    }),
    detractorMaxScore: z.number().int().nullable().meta({
      description:
        'Maior nota que conta como detrator; nulo usa o padrão do tipo (NPS 6, CSAT 2, CES 3).',
    }),
    questionText: z.string().nullable(),
    thankYouText: z.string().nullable(),
  }),
)

export const SurveyDTO = dto(
  'SatisfactionSurvey',
  z.object({
    id: z.string(),
    kind,
    trigger: z.enum(['CONVERSATION_CLOSED', 'TICKET_RESOLVED', 'MANUAL']),
    channel: z.enum(['WHATSAPP', 'EMAIL']),
    status: z.enum(['SCHEDULED', 'SENT', 'ANSWERED', 'SKIPPED', 'FAILED']),
    conversationId: z.string().nullable(),
    ticketId: z.string().nullable(),
    recipientName: z.string().nullable(),
    customerName: z.string().nullable(),
    assigneeName: z.string().nullable(),
    teamName: z.string().nullable(),
    score: z.number().int().nullable(),
    comment: z.string().nullable(),
    failureReason: z.string().nullable(),
    sentAt: nullableDateTime(),
    answeredAt: nullableDateTime(),
    createdAt: z.iso.datetime(),
  }),
)

export const SurveyListDTO = dto(
  'SatisfactionSurveyPage',
  z.object({
    items: z.array(SurveyDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

const reportRow = z.object({
  key: z.string(),
  name: z.string(),
  sent: z.number().int(),
  answered: z.number().int(),
  responseRate: z.number().nullable(),
  average: z.number().nullable(),
  nps: z.number().nullable(),
  csat: z.number().nullable(),
  ces: z.number().nullable(),
  promoters: z.number().int(),
  passives: z.number().int(),
  detractors: z.number().int(),
})

export const SurveyReportDTO = dto(
  'SatisfactionSurveyReport',
  z.object({
    kind,
    groupBy: z.enum(['agent', 'team', 'technician', 'customer']),
    from: nullableDateTime(),
    to: nullableDateTime(),
    total: reportRow,
    rows: z.array(reportRow),
  }),
)

export const PublicSurveyDTO = dto(
  'SatisfactionSurveyPublic',
  z.object({
    kind,
    question: z.string(),
    scaleMin: z.number().int(),
    scaleMax: z.number().int(),
    workspaceName: z.string(),
    state: z.enum(['OPEN', 'ANSWERED', 'EXPIRED']),
  }),
)

export const SurveyAnsweredDTO = dto(
  'SatisfactionSurveyAnswered',
  z.object({ answered: z.literal(true) }),
)
