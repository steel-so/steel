import z from 'zod'
import { EmailCanvasDocumentSchema } from './crm-email-builder.schema'

/**
 * Newsletter automation (newsletter2, slice nl2-automation): the welcome
 * series (ordered e-mails sent after the subscriber's confirmation) and the
 * re-engagement of inactive subscribers.
 */

// ─── Welcome series ──────────────────────────────────────────────────────────

export const CRM_NEWSLETTER_DELAY_UNITS = ['HOURS', 'DAYS'] as const
export type CrmNewsletterDelayUnitValue =
  (typeof CRM_NEWSLETTER_DELAY_UNITS)[number]

/** Steps per newsletter. */
export const CRM_NEWSLETTER_WELCOME_MAX_STEPS = 10
/** Longest delay after the confirmation: one year. */
export const CRM_NEWSLETTER_WELCOME_MAX_DELAY_HOURS = 365 * 24
/**
 * A step that became due more than this long ago is never sent (a series
 * created or switched on today does not mail people who confirmed months
 * ago; a worker outage shorter than this only delays the e-mails).
 */
export const CRM_NEWSLETTER_WELCOME_STALE_DAYS = 7

/** Delay of a step in hours. */
export function welcomeDelayHours(
  value: number,
  unit: CrmNewsletterDelayUnitValue,
): number {
  return unit === 'DAYS' ? value * 24 : value
}

const DelayFields = {
  delayValue: z.coerce
    .number()
    .int('Use um número inteiro')
    .min(0, 'O atraso não pode ser negativo'),
  delayUnit: z.enum(CRM_NEWSLETTER_DELAY_UNITS),
}

const delayWithinLimit = (value: {
  delayValue?: number
  delayUnit?: CrmNewsletterDelayUnitValue
}) =>
  value.delayValue === undefined ||
  value.delayUnit === undefined ||
  welcomeDelayHours(value.delayValue, value.delayUnit) <=
    CRM_NEWSLETTER_WELCOME_MAX_DELAY_HOURS

const DELAY_LIMIT_MESSAGE = {
  message: 'O atraso máximo é de 365 dias',
  path: ['delayValue'],
}

export const CreateCrmNewsletterWelcomeStepSchema = z
  .object({
    subject: z.string().trim().min(1, 'Assunto é obrigatório').max(200),
    preheader: z.string().trim().max(200).optional(),
    ...DelayFields,
  })
  .refine(delayWithinLimit, DELAY_LIMIT_MESSAGE)

export type CreateCrmNewsletterWelcomeStepDTO = z.infer<
  typeof CreateCrmNewsletterWelcomeStepSchema
>

/** Editor autosave and the step list (switch, delay). */
export const UpdateCrmNewsletterWelcomeStepSchema = z
  .object({
    subject: z.string().trim().min(1, 'Assunto é obrigatório').max(200),
    preheader: z.string().trim().max(200).nullable(),
    delayValue: DelayFields.delayValue,
    delayUnit: DelayFields.delayUnit,
    enabled: z.boolean(),
    builderDocument: EmailCanvasDocumentSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })
  .refine(
    (value) =>
      (value.delayValue === undefined) === (value.delayUnit === undefined),
    {
      message: 'Informe o atraso e a unidade juntos',
      path: ['delayUnit'],
    },
  )
  .refine(delayWithinLimit, DELAY_LIMIT_MESSAGE)

export type UpdateCrmNewsletterWelcomeStepDTO = z.infer<
  typeof UpdateCrmNewsletterWelcomeStepSchema
>

/** New order of the steps: every step id of the newsletter, once. */
export const ReorderCrmNewsletterWelcomeStepsSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(CRM_NEWSLETTER_WELCOME_MAX_STEPS)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Etapas repetidas',
    }),
})

export type ReorderCrmNewsletterWelcomeStepsDTO = z.infer<
  typeof ReorderCrmNewsletterWelcomeStepsSchema
>

export type CrmNewsletterWelcomeStepStatsDTO = {
  sent: number
  /** Unique opens. */
  opened: number
  /** Unique clickers. */
  clicked: number
}

export type CrmNewsletterWelcomeStepDTO = {
  id: string
  newsletterId: string
  position: number
  delayValue: number
  delayUnit: CrmNewsletterDelayUnitValue
  subject: string
  preheader: string | null
  enabled: boolean
  stats: CrmNewsletterWelcomeStepStatsDTO
  /** Only in the detail (editor). */
  builderDocument?: unknown
  createdAt: string
  updatedAt: string
}

// ─── Re-engagement ───────────────────────────────────────────────────────────

export const CRM_NEWSLETTER_REENGAGEMENT_ACTIONS = [
  'UNSUBSCRIBE',
  'FLAG',
] as const
export type CrmNewsletterReengagementActionValue =
  (typeof CRM_NEWSLETTER_REENGAGEMENT_ACTIONS)[number]

export const CRM_NEWSLETTER_REENGAGEMENT_STATUSES = [
  'SENDING',
  'WAITING',
  'REENGAGED',
  'UNSUBSCRIBED',
  'FLAGGED',
  'SKIPPED',
  'FAILED',
] as const
export type CrmNewsletterReengagementStatusValue =
  (typeof CRM_NEWSLETTER_REENGAGEMENT_STATUSES)[number]

/** `unsubscribeReason` of a subscriber removed for inactivity. */
export const CRM_NEWSLETTER_INACTIVE_REASON = 'inativo'

export const CRM_NEWSLETTER_REENGAGEMENT_LIMITS = {
  minIssues: { min: 1, max: 50 },
  inactiveDays: { min: 30, max: 365 },
  graceDays: { min: 7, max: 90 },
} as const

/** Defaults of a newsletter that never saved the section (off). */
export const CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS = {
  enabled: false,
  minIssues: 3,
  inactiveDays: 90,
  graceDays: 30,
  action: 'UNSUBSCRIBE' as CrmNewsletterReengagementActionValue,
  subject: 'Você ainda quer receber nossa newsletter?',
  heading: 'Sentimos sua falta',
  body: 'Faz um tempo que você não abre nossos e-mails. Se ainda quiser receber a newsletter, é só clicar no botão abaixo.\n\nSe não clicar, vamos parar de enviar para não lotar a sua caixa de entrada.',
  buttonLabel: 'Quero continuar recebendo',
}

const { minIssues, inactiveDays, graceDays } =
  CRM_NEWSLETTER_REENGAGEMENT_LIMITS

const MinIssuesSchema = z.coerce
  .number()
  .int()
  .min(minIssues.min, `Mínimo de ${minIssues.min} edição`)
  .max(minIssues.max, `Máximo de ${minIssues.max} edições`)
const InactiveDaysSchema = z.coerce
  .number()
  .int()
  .min(inactiveDays.min, `Mínimo de ${inactiveDays.min} dias`)
  .max(inactiveDays.max, `Máximo de ${inactiveDays.max} dias`)

export const UpdateCrmNewsletterReengagementSchema = z.object({
  enabled: z.boolean(),
  minIssues: MinIssuesSchema,
  inactiveDays: InactiveDaysSchema,
  graceDays: z.coerce
    .number()
    .int()
    .min(graceDays.min, `Mínimo de ${graceDays.min} dias`)
    .max(graceDays.max, `Máximo de ${graceDays.max} dias`),
  action: z.enum(CRM_NEWSLETTER_REENGAGEMENT_ACTIONS),
  subject: z.string().trim().min(1, 'Assunto é obrigatório').max(200),
  heading: z.string().trim().min(1, 'Título é obrigatório').max(200),
  body: z.string().trim().min(1, 'Texto é obrigatório').max(2000),
  buttonLabel: z.string().trim().min(1, 'Texto do botão é obrigatório').max(60),
})

export type UpdateCrmNewsletterReengagementDTO = z.infer<
  typeof UpdateCrmNewsletterReengagementSchema
>

/** Preview with values not saved yet (the form being edited). */
export const CrmNewsletterReengagementPreviewQuerySchema = z.object({
  minIssues: MinIssuesSchema.optional(),
  inactiveDays: InactiveDaysSchema.optional(),
})

export type CrmNewsletterReengagementPreviewQuery = z.infer<
  typeof CrmNewsletterReengagementPreviewQuerySchema
>

export type CrmNewsletterReengagementPreviewDTO = {
  /** Would get the re-engagement e-mail if the run were now. */
  candidates: number
  /** E-mail sent, still inside the grace period. */
  waiting: number
  /** Grace period over without engagement: next daily run removes/flags. */
  dueNow: number
}

export type CrmNewsletterReengagementTotalsDTO = {
  sent: number
  reengaged: number
  unsubscribed: number
  flagged: number
}

export type CrmNewsletterReengagementDTO =
  UpdateCrmNewsletterReengagementDTO & {
    newsletterId: string
    /** False while the section was never saved (defaults shown). */
    saved: boolean
    updatedAt: string | null
    preview: CrmNewsletterReengagementPreviewDTO
    totals: CrmNewsletterReengagementTotalsDTO
  }

/** Public "Quero continuar recebendo" page. */
export type NewsletterReengagePreviewDTO = {
  email: string
  newsletterName: string
  publisherName: string
  /** Already confirmed (or back) — the page shows the thank-you state. */
  alreadyConfirmed: boolean
}

export type NewsletterReengageResultDTO = {
  newsletterName: string
  /** The subscriber had been removed for inactivity and is back. */
  resubscribed: boolean
}
