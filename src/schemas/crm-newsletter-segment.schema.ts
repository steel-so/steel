import z from 'zod'
import { CRM_NEWSLETTER_SUBSCRIBER_SOURCES } from './crm-newsletter.schema'

/**
 * Audience segments of newsletter issues (newsletter2, slice nl2-segments).
 *
 * A segment is an AND of `conditions` plus optional OR `groups`: every
 * top-level condition must match AND, for each group, at least one of its
 * conditions must match. `{}` (no conditions, no groups) = every ACTIVE
 * subscriber, which is what phase 1 always sent to. The send base (ACTIVE,
 * outside the workspace-wide opt-out) is never part of the segment — a
 * segment only narrows it. Compiled to Prisma by
 * `src/lib/crm-newsletter/segment-where.ts`.
 */

/** Issues an engagement condition may look back at. */
export const CRM_NEWSLETTER_SEGMENT_MAX_LOOKBACK = 50
export const CRM_NEWSLETTER_SEGMENT_MAX_CONDITIONS = 20
export const CRM_NEWSLETTER_SEGMENT_MAX_GROUPS = 5
export const CRM_NEWSLETTER_SEGMENT_MAX_GROUP_CONDITIONS = 10
/** Saved segments per newsletter. */
export const CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER = 50
/** Subscribers shown by the audience preview. */
export const CRM_NEWSLETTER_AUDIENCE_SAMPLE_SIZE = 10

export const CRM_LEAD_STAGE_VALUES = [
  'RECEIVED',
  'IN_CONTACT',
  'QUALIFIED',
  'OPPORTUNITY',
  'PROPOSAL',
  'CLOSED',
] as const

/** Calendar day (America/Sao_Paulo), e.g. "2026-10-01". */
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00-03:00`)), {
    message: 'Data inválida',
  })

const TextValueSchema = z
  .string()
  .trim()
  .min(1, 'Informe um valor')
  .max(120, 'Use no máximo 120 caracteres')

const LookbackSchema = z.coerce
  .number()
  .int()
  .min(1, 'Use pelo menos 1 edição')
  .max(
    CRM_NEWSLETTER_SEGMENT_MAX_LOOKBACK,
    `Use no máximo ${CRM_NEWSLETTER_SEGMENT_MAX_LOOKBACK} edições`,
  )

const IdSchema = z.string().trim().min(1).max(64)

export const NewsletterSegmentConditionSchema = z.discriminatedUnion('type', [
  // ─── Subscriber ────────────────────────────────────────────────────────
  z.object({
    type: z.literal('source'),
    sources: z
      .array(z.enum(CRM_NEWSLETTER_SUBSCRIBER_SOURCES))
      .min(1, 'Escolha ao menos uma origem')
      .max(CRM_NEWSLETTER_SUBSCRIBER_SOURCES.length),
  }),
  z.object({
    type: z.literal('subscribed'),
    /** `before` = strictly before the day; `onOrAfter` = from the day on. */
    op: z.enum(['before', 'onOrAfter']),
    date: DaySchema,
  }),
  z.object({
    type: z.literal('confirmed'),
    /** Confirmed the double opt-in (`confirmedAt` set). */
    value: z.boolean(),
  }),
  // ─── Engagement ────────────────────────────────────────────────────────
  z.object({
    type: z.literal('opened'),
    /** `any` = opened at least one of the last N sent issues; `none` = none. */
    op: z.enum(['any', 'none']),
    lastIssues: LookbackSchema,
  }),
  z.object({
    type: z.literal('clicked'),
    op: z.enum(['any', 'none']),
    lastIssues: LookbackSchema,
  }),
  z.object({ type: z.literal('neverOpened') }),
  z.object({
    type: z.literal('lastOpenedBefore'),
    /** Opened at least once, and the last open was before the day. */
    date: DaySchema,
  }),
  // ─── Linked CRM person ─────────────────────────────────────────────────
  z.object({
    type: z.literal('linkedPerson'),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal('company'),
    companyIds: z
      .array(IdSchema)
      .min(1, 'Escolha ao menos uma empresa')
      .max(50, 'Escolha no máximo 50 empresas'),
  }),
  z.object({
    type: z.literal('jobTitle'),
    op: z.enum(['equals', 'contains']),
    value: TextValueSchema,
  }),
  z.object({
    type: z.literal('city'),
    op: z.enum(['equals', 'contains']),
    value: TextValueSchema,
  }),
  z.object({
    type: z.literal('customField'),
    /** A PERSON custom field definition of the workspace. */
    definitionId: IdSchema,
    op: z.enum(['equals', 'contains', 'isSet', 'isNotSet']),
    value: z
      .union([z.string().trim().max(200), z.number(), z.boolean()])
      .optional(),
  }),
  z.object({
    type: z.literal('openOpportunity'),
    /** The person (or their company) has an opportunity in an OPEN stage. */
    value: z.boolean(),
  }),
  z.object({
    type: z.literal('leadStage'),
    /** Stage of a lead converted into the person. */
    stages: z
      .array(z.enum(CRM_LEAD_STAGE_VALUES))
      .min(1, 'Escolha ao menos uma etapa')
      .max(CRM_LEAD_STAGE_VALUES.length),
  }),
])

export type NewsletterSegmentCondition = z.infer<
  typeof NewsletterSegmentConditionSchema
>
export type NewsletterSegmentConditionType = NewsletterSegmentCondition['type']

/** `equals`/`contains` on a custom field need a value. */
const ConditionSchema = NewsletterSegmentConditionSchema.superRefine(
  (condition, ctx) => {
    if (
      condition.type === 'customField' &&
      (condition.op === 'equals' || condition.op === 'contains') &&
      (condition.value === undefined || condition.value === '')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Informe um valor',
      })
    }
  },
)

export const NewsletterSegmentGroupSchema = z.object({
  /** OR: at least one must match. */
  conditions: z
    .array(ConditionSchema)
    .min(1, 'Um grupo precisa de ao menos uma condição')
    .max(CRM_NEWSLETTER_SEGMENT_MAX_GROUP_CONDITIONS),
})

export const NewsletterSegmentSchema = z.object({
  /** AND: every one must match. */
  conditions: z
    .array(ConditionSchema)
    .max(
      CRM_NEWSLETTER_SEGMENT_MAX_CONDITIONS,
      `Use no máximo ${CRM_NEWSLETTER_SEGMENT_MAX_CONDITIONS} condições`,
    )
    .default([]),
  groups: z
    .array(NewsletterSegmentGroupSchema)
    .max(
      CRM_NEWSLETTER_SEGMENT_MAX_GROUPS,
      `Use no máximo ${CRM_NEWSLETTER_SEGMENT_MAX_GROUPS} grupos`,
    )
    .default([]),
})

export type NewsletterSegment = z.infer<typeof NewsletterSegmentSchema>

/** `true` when the segment does not narrow anything (= every subscriber). */
export function isEmptySegment(segment: NewsletterSegment): boolean {
  return segment.conditions.length === 0 && segment.groups.length === 0
}

/**
 * What `CrmNewsletterIssue.segment` stores: the definition (a copy — editing
 * a saved segment later does not change issues already using it) and the
 * saved segment it came from, if any.
 */
export const StoredIssueSegmentSchema = NewsletterSegmentSchema.extend({
  savedSegmentId: IdSchema.nullable().optional(),
})

export type StoredIssueSegment = z.infer<typeof StoredIssueSegmentSchema>

// ─── Saved segments ─────────────────────────────────────────────────────────

const SegmentNameSchema = z
  .string()
  .trim()
  .min(1, 'Nome é obrigatório')
  .max(80, 'Use no máximo 80 caracteres')

export const CreateCrmNewsletterSegmentSchema = z.object({
  name: SegmentNameSchema,
  definition: NewsletterSegmentSchema,
})

export type CreateCrmNewsletterSegmentDTO = z.infer<
  typeof CreateCrmNewsletterSegmentSchema
>

export const UpdateCrmNewsletterSegmentSchema = z
  .object({
    name: SegmentNameSchema,
    definition: NewsletterSegmentSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateCrmNewsletterSegmentDTO = z.infer<
  typeof UpdateCrmNewsletterSegmentSchema
>

export type CrmNewsletterSegmentDTO = {
  id: string
  newsletterId: string
  name: string
  definition: NewsletterSegment
  /** `false` when the stored definition no longer parses (shown as empty). */
  valid: boolean
  createdAt: string
  updatedAt: string
}

// ─── Issue audience ─────────────────────────────────────────────────────────

/** "Público" of an issue: `{ conditions: [], groups: [] }` = everyone. */
export const SetIssueSegmentSchema = z.object({
  segment: NewsletterSegmentSchema,
  savedSegmentId: IdSchema.nullable().optional(),
})

export type SetIssueSegmentDTO = z.infer<typeof SetIssueSegmentSchema>

export type CrmNewsletterIssueSegmentDTO = {
  segment: NewsletterSegment
  savedSegmentId: string | null
  /** Name of the saved segment, when it still exists. */
  savedSegmentName: string | null
  /** No condition: every ACTIVE subscriber. */
  everyone: boolean
}

/** Omitted `segment` → the issue's stored segment. */
export const AudiencePreviewSchema = z.object({
  segment: NewsletterSegmentSchema.optional(),
})

export type AudiencePreviewDTO = z.infer<typeof AudiencePreviewSchema>

export type CrmNewsletterAudiencePreviewDTO = {
  /** Subscribers the issue would go to (ACTIVE, outside the opt-out). */
  count: number
  /** Every ACTIVE subscriber outside the opt-out (the unsegmented audience). */
  total: number
  sample: { id: string; email: string; name: string | null }[]
}

export const SegmentOptionsQuerySchema = z.object({
  companyQuery: z.string().trim().max(120).optional(),
  /** Comma-separated ids already chosen (always returned, by name). */
  companyIds: z
    .string()
    .max(4000)
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50),
    ),
})

export type SegmentOptionsQuery = z.infer<typeof SegmentOptionsQuerySchema>

export type CrmNewsletterSegmentOptionsDTO = {
  companies: { id: string; name: string }[]
  customFields: {
    id: string
    label: string
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT'
    options: string[]
  }[]
}
