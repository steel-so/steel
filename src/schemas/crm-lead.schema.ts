import z from 'zod'

export const CrmLeadStageEnum = z.enum([
  'RECEIVED',
  'IN_CONTACT',
  'QUALIFIED',
  'OPPORTUNITY',
  'PROPOSAL',
  'CLOSED',
])

export const CreateCrmLeadSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    emails: z.array(z.email()).default([]),
    phones: z.array(z.string().max(30)).default([]),
    company: z.string().max(200).optional(),
    jobTitle: z.string().max(150).optional(),
    city: z.string().max(100).optional(),
    linkedin: z.string().max(300).optional(),
    source: z.string().min(1, 'Origem é obrigatória').max(100),
    channel: z.string().max(100).optional(),
  })
  .refine((data) => data.emails.length > 0 || data.phones.length > 0, {
    message: 'Informe ao menos um email ou telefone',
    path: ['emails'],
  })
// stage nunca é definível pelo cliente na criação — todo lead nasce em RECEIVED.

export type CreateCrmLeadDTO = z.infer<typeof CreateCrmLeadSchema>

/** Entrada crua de qualquer canal (manual, API de integração, formulário
 * público). O `CrmLeadService.intake` valida com `CreateCrmLeadSchema` —
 * um único contrato para todos os canais. */
export type CrmLeadIntakeInput = z.input<typeof CreateCrmLeadSchema>

export const UpdateCrmLeadSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
  emails: z.array(z.email()).optional(),
  phones: z.array(z.string().max(30)).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(150).optional(),
  city: z.string().max(100).optional(),
  linkedin: z.string().max(300).optional(),
  source: z.string().max(100).optional(),
  channel: z.string().max(100).optional(),
  // Nullable: a coluna é limpável na grade (envia null para desvincular).
  ownerId: z.string().nullable().optional(),
})

export type UpdateCrmLeadDTO = z.infer<typeof UpdateCrmLeadSchema>

export const ListCrmLeadsSchema = z.object({
  stage: CrmLeadStageEnum.optional(),
})

export type ListCrmLeadsDTO = z.infer<typeof ListCrmLeadsSchema>

export const ReorderCrmLeadsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmLeadsDTO = z.infer<typeof ReorderCrmLeadsSchema>

// --- 01 Recebido -> 02 Em Contato / 02 -> 03 Qualificado ---

const CrmLeadContactChannelEnum = z.enum([
  'PHONE',
  'WHATSAPP',
  'EMAIL',
  'MEETING',
  'OTHER',
])

export const CrmLeadContactOutcomeEnum = z.enum(['ATTEMPTED', 'REACHED'])

export const RegisterCrmLeadContactAttemptSchema = z.object({
  contactedWith: z
    .string()
    .min(1, 'Informe com quem falou ou tentou falar')
    .max(200),
  channel: CrmLeadContactChannelEnum,
  outcome: CrmLeadContactOutcomeEnum.default('ATTEMPTED'),
  occurredAt: z.coerce.date().default(() => new Date()),
  note: z.string().max(2000).optional(),
})

export type RegisterCrmLeadContactAttemptDTO = z.infer<
  typeof RegisterCrmLeadContactAttemptSchema
>

export const SetCrmLeadInterestProductsSchema = z.object({
  productIds: z
    .array(z.string())
    .min(1, 'Selecione ao menos um produto/serviço'),
})

export type SetCrmLeadInterestProductsDTO = z.infer<
  typeof SetCrmLeadInterestProductsSchema
>

// --- 03 Lead Qualificado — gate de QUALIFIED -> OPPORTUNITY ---

export const UpsertCrmLeadQualificationSchema = z.object({
  expectedCloseAt: z.coerce.date().optional(),
  decisionMakerName: z
    .string()
    .min(1, 'Nome do decisor é obrigatório')
    .max(200),
  decisionMakerRole: z
    .string()
    .min(1, 'Cargo do decisor é obrigatório')
    .max(150),
})

export type UpsertCrmLeadQualificationDTO = z.infer<
  typeof UpsertCrmLeadQualificationSchema
>

// --- 04 Interesse/Oportunidade ---

const CrmLeadMeetingFormatEnum = z.enum(['IN_PERSON', 'ONLINE'])

export const RegisterCrmLeadMeetingSchema = z.object({
  scheduledAt: z.coerce.date(),
  format: CrmLeadMeetingFormatEnum,
  contactPersonId: z.string().optional(),
  contactPersonName: z.string().max(200).optional(),
  interestDetails: z
    .string()
    .min(1, 'Detalhe o interesse identificado')
    .max(2000),
  identifiedNeed: z
    .string()
    .min(1, 'Descreva a necessidade identificada')
    .max(2000),
})

export type RegisterCrmLeadMeetingDTO = z.infer<
  typeof RegisterCrmLeadMeetingSchema
>

// OPPORTUNITY -> PROPOSAL: a criação da proposta em si é a transição.
export const CreateCrmLeadProposalSchema = z.object({
  name: z.string().min(1, 'Nome da proposta é obrigatório').max(200),
  templateId: z.string().optional(),
  validUntil: z.coerce.date().optional(),
})

export type CreateCrmLeadProposalDTO = z.infer<
  typeof CreateCrmLeadProposalSchema
>

// --- 05 Proposta (inclui o Termômetro de Interesse) ---

const CrmLeadProposalFormatEnum = z.enum([
  'IN_PERSON',
  'ONLINE',
  'EMAIL',
  'OTHER',
])

export const CrmLeadInterestLevelEnum = z.enum([
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
])

export const RegisterCrmLeadProposalPresentationSchema = z.object({
  presentedAt: z.coerce.date(),
  format: CrmLeadProposalFormatEnum,
  amount: z.number().nonnegative(),
  interestLevel: CrmLeadInterestLevelEnum,
  interactionsCount: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional(),
})

export type RegisterCrmLeadProposalPresentationDTO = z.infer<
  typeof RegisterCrmLeadProposalPresentationSchema
>

// --- 06 Fechado/Encerrado ---

export const CloseCrmLeadWonSchema = z.object({
  contractSignedAt: z.coerce.date(),
  billingType: z.enum(['ONE_TIME', 'MONTHLY', 'YEARLY']),
  closedAmount: z.number().nonnegative(),
  contractSignedConfirmed: z.literal(true),
})

export type CloseCrmLeadWonDTO = z.infer<typeof CloseCrmLeadWonSchema>

export const CloseCrmLeadLostSchema = z.object({
  lostReason: z.string().min(1, 'Informe o motivo da perda').max(200),
  lostNote: z.string().max(2000).optional(),
  retryAt: z.coerce.date().optional(),
})

export type CloseCrmLeadLostDTO = z.infer<typeof CloseCrmLeadLostSchema>

// Reabre um lead perdido: volta para a etapa configurada em CrmSettings. O
// motivo é obrigatório — fica no histórico de reaberturas junto com o
// snapshot da perda desfeita.
export const ReopenCrmLeadSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Informe o motivo da reabertura')
    .max(1000, 'O motivo pode ter no máximo 1000 caracteres'),
})

export type ReopenCrmLeadDTO = z.infer<typeof ReopenCrmLeadSchema>

const LeadRuleFieldEnum = z.enum([
  'name',
  'email',
  'phone',
  'company',
  'jobTitle',
  'source',
  'city',
])

const LeadRuleOperatorEnum = z.enum([
  'equals',
  'not_equals',
  'contains',
  'is_empty',
  'is_not_empty',
])

/**
 * Engagement events a scoring rule may award points for (newsletter bridge,
 * ADR 0054 phase 2). They are not lead fields: the points land when the
 * event happens to a lead linked to the person/e-mail, once per event
 * (`CrmLeadScoreEvent`). Only `newsletter_clicked` reads `value`, as an
 * optional "URL contains" filter. Routing rules never use them.
 */
export const CRM_LEAD_EVENT_RULE_FIELDS = [
  'newsletter_subscribed',
  'newsletter_opened',
  'newsletter_clicked',
] as const
export type CrmLeadEventRuleField = (typeof CRM_LEAD_EVENT_RULE_FIELDS)[number]

const ScoringRuleFieldEnum = z.enum([
  ...LeadRuleFieldEnum.options,
  ...CRM_LEAD_EVENT_RULE_FIELDS,
])

export const CreateCrmLeadScoringRuleSchema = z.object({
  field: ScoringRuleFieldEnum,
  operator: LeadRuleOperatorEnum,
  value: z.string().max(200).optional(),
  points: z.number().int().default(0),
  active: z.boolean().default(true),
  /** `newsletter_opened` / `newsletter_clicked` only: also score the welcome
   * series e-mails (default on; ignored by the other fields). */
  includeWelcome: z.boolean().optional(),
})

export type CreateCrmLeadScoringRuleDTO = z.infer<
  typeof CreateCrmLeadScoringRuleSchema
>

export const UpdateCrmLeadScoringRuleSchema = z.object({
  field: ScoringRuleFieldEnum.optional(),
  operator: LeadRuleOperatorEnum.optional(),
  value: z.string().max(200).optional(),
  points: z.number().int().optional(),
  active: z.boolean().optional(),
  includeWelcome: z.boolean().optional(),
})

export type UpdateCrmLeadScoringRuleDTO = z.infer<
  typeof UpdateCrmLeadScoringRuleSchema
>

export const CreateCrmLeadRoutingRuleSchema = z.object({
  field: LeadRuleFieldEnum,
  operator: LeadRuleOperatorEnum,
  value: z.string().max(200).optional(),
  ownerId: z.string().min(1, 'Responsável é obrigatório'),
  active: z.boolean().default(true),
})

export type CreateCrmLeadRoutingRuleDTO = z.infer<
  typeof CreateCrmLeadRoutingRuleSchema
>

export const UpdateCrmLeadRoutingRuleSchema = z.object({
  field: LeadRuleFieldEnum.optional(),
  operator: LeadRuleOperatorEnum.optional(),
  value: z.string().max(200).optional(),
  ownerId: z.string().min(1).optional(),
  active: z.boolean().optional(),
})

export type UpdateCrmLeadRoutingRuleDTO = z.infer<
  typeof UpdateCrmLeadRoutingRuleSchema
>
