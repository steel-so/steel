import z from 'zod'

export const SurveyKindSchema = z.enum(['NPS', 'CSAT', 'CES'])
export const SurveyTriggerSchema = z.enum([
  'CONVERSATION_CLOSED',
  'TICKET_RESOLVED',
  'MANUAL',
])
/** Triggers an admin can configure (manual sends have no rule). */
export const SurveyConfigTriggerSchema = z.enum([
  'CONVERSATION_CLOSED',
  'TICKET_RESOLVED',
])

/** Update of the rule of one trigger; omitted fields keep their value. */
export const UpdateSurveyConfigSchema = z.object({
  kind: SurveyKindSchema.optional(),
  enabled: z.boolean().optional(),
  delayMinutes: z
    .number()
    .int()
    .min(0, 'O atraso não pode ser negativo')
    .max(1440, 'O atraso máximo é de 24 horas')
    .optional(),
  expiresInHours: z
    .number()
    .int()
    .min(1, 'A pesquisa precisa durar ao menos 1 hora')
    .max(720, 'A validade máxima é de 30 dias')
    .optional(),
  cooldownDays: z
    .number()
    .int()
    .min(0, 'O intervalo não pode ser negativo')
    .max(365, 'O intervalo máximo é de 365 dias')
    .optional(),
  emailFallback: z.boolean().optional(),
  alertDetractors: z.boolean().optional(),
  detractorMaxScore: z
    .number()
    .int('Informe um número inteiro')
    .min(0, 'A nota mínima é 0')
    .max(9, 'A nota máxima do limite é 9')
    .nullable()
    .optional(),
  questionText: z
    .string()
    .trim()
    .max(600, 'Pergunta muito longa (máx. 600 caracteres)')
    .nullable()
    .optional(),
  thankYouText: z
    .string()
    .trim()
    .max(600, 'Agradecimento muito longo (máx. 600 caracteres)')
    .nullable()
    .optional(),
})
export type UpdateSurveyConfigDTO = z.infer<typeof UpdateSurveyConfigSchema>

/** Manual / post-sale send to a WhatsApp contact or an e-mail address. */
export const SendSurveySchema = z
  .object({
    kind: SurveyKindSchema,
    whatsappContactId: z.string().min(1).optional(),
    email: z.string().trim().email('E-mail inválido').optional(),
    recipientName: z.string().trim().max(200).optional(),
    customerName: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.whatsappContactId || v.email, {
    message: 'Informe um contato do WhatsApp ou um e-mail',
    path: ['whatsappContactId'],
  })
export type SendSurveyDTO = z.infer<typeof SendSurveySchema>

/** Answer from the public e-mail page. */
export const AnswerSurveySchema = z.object({
  score: z
    .number({ error: 'Escolha uma nota' })
    .int('Escolha uma nota')
    .min(0, 'Escolha uma nota')
    .max(10, 'Escolha uma nota'),
  comment: z
    .string()
    .trim()
    .max(2000, 'Comentário muito longo (máx. 2000 caracteres)')
    .optional()
    .transform((value) => (value ? value : undefined)),
})
export type AnswerSurveyDTO = z.input<typeof AnswerSurveySchema>

export const SURVEY_REPORT_GROUPS = [
  'agent',
  'team',
  'technician',
  'customer',
] as const

export const SurveyReportQuerySchema = z.object({
  kind: SurveyKindSchema.default('CSAT'),
  groupBy: z.enum(SURVEY_REPORT_GROUPS).default('agent'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})
export type SurveyReportQueryDTO = z.infer<typeof SurveyReportQuerySchema>

export const SurveyListQuerySchema = z.object({
  kind: SurveyKindSchema.optional(),
  status: z
    .enum(['SCHEDULED', 'SENT', 'ANSWERED', 'SKIPPED', 'FAILED'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type SurveyListQueryDTO = z.infer<typeof SurveyListQuerySchema>
