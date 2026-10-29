import { Prisma } from '@prisma/client'
import {
  isEmptySegment,
  type NewsletterSegment,
  type NewsletterSegmentCondition,
  type StoredIssueSegment,
  StoredIssueSegmentSchema,
} from '@/src/schemas/crm-newsletter-segment.schema'

/**
 * Pure compiler of a newsletter segment into a Prisma
 * `CrmNewsletterSubscriberWhereInput` (slice nl2-segments). It narrows the
 * send base only: the caller adds newsletter, ACTIVE and the opt-out.
 *
 * Two inputs cannot be expressed as a nested Prisma filter and are resolved
 * by the repository first, then handed in through `SegmentContext`:
 * - the ids of the last sent issues (engagement look-back);
 * - the person ids matching each custom field condition (custom field
 *   values point at their record by a plain `recordId`, no relation).
 */

export type CustomFieldCondition = Extract<
  NewsletterSegmentCondition,
  { type: 'customField' }
>

export type SegmentContext = {
  /** Sent issues of the newsletter, newest first (≥ the largest look-back). */
  recentIssueIds: string[]
  /** `customFieldKey(condition)` → ids of the people it matches. */
  customFieldPersonIds: Record<string, string[]>
}

export type SegmentNeeds = {
  /** Largest `lastIssues` among the engagement conditions (0 = none). */
  lookback: number
  /** Custom field conditions to resolve, one per distinct key. */
  customFields: CustomFieldCondition[]
}

type Where = Prisma.CrmNewsletterSubscriberWhereInput

/** Matches nothing (Prisma turns `in: []` into a false predicate). */
const NOTHING: Where = { id: { in: [] } }

/**
 * Start of a calendar day in America/Sao_Paulo. Brazil has no daylight
 * saving time since 2019, so the offset is a fixed -03:00.
 */
export function saoPauloDayStart(day: string): Date {
  return new Date(`${day}T00:00:00-03:00`)
}

/**
 * Lookup key of a custom field condition. `isNotSet` shares the key of
 * `isSet` — it is resolved as "is set" and negated by the compiler.
 */
export function customFieldKey(condition: CustomFieldCondition): string {
  const op = condition.op === 'isNotSet' ? 'isSet' : condition.op
  const value =
    op === 'isSet' ? '' : JSON.stringify(condition.value ?? null).toLowerCase()
  return `${condition.definitionId}|${op}|${value}`
}

function allConditions(segment: NewsletterSegment) {
  return [
    ...segment.conditions,
    ...segment.groups.flatMap((group) => group.conditions),
  ]
}

/** What the repository must resolve before compiling. */
export function segmentNeeds(segment: NewsletterSegment): SegmentNeeds {
  let lookback = 0
  const customFields = new Map<string, CustomFieldCondition>()
  for (const condition of allConditions(segment)) {
    if (condition.type === 'opened' || condition.type === 'clicked') {
      lookback = Math.max(lookback, condition.lastIssues)
    }
    if (condition.type === 'customField') {
      const key = customFieldKey(condition)
      if (!customFields.has(key)) {
        customFields.set(key, {
          ...condition,
          op: condition.op === 'isNotSet' ? 'isSet' : condition.op,
        })
      }
    }
  }
  return { lookback, customFields: [...customFields.values()] }
}

/** A person of the CRM that was not deleted, plus `extra`. */
function person(extra: Prisma.CrmPersonWhereInput = {}): Where {
  return { person: { is: { deletedAt: null, ...extra } } }
}

/**
 * Negation of a person filter that keeps subscribers without a person:
 * `NOT` over a to-one relation is NULL (excluded) when `personId` is null.
 */
function notPerson(extra: Prisma.CrmPersonWhereInput = {}): Where {
  return { OR: [{ personId: null }, { NOT: person(extra) }] }
}

const OPEN_OPPORTUNITY: Prisma.CrmOpportunityWhereInput = {
  deletedAt: null,
  stage: { is: { category: 'OPEN' } },
}

const HAS_OPEN_OPPORTUNITY: Prisma.CrmPersonWhereInput = {
  OR: [
    { opportunitiesAsPointOfContact: { some: OPEN_OPPORTUNITY } },
    {
      company: {
        is: { deletedAt: null, opportunities: { some: OPEN_OPPORTUNITY } },
      },
    },
  ],
}

function text(op: 'equals' | 'contains', value: string) {
  return op === 'equals'
    ? { equals: value, mode: 'insensitive' as const }
    : { contains: value, mode: 'insensitive' as const }
}

function engagement(
  field: 'openedAt' | 'clickedAt',
  op: 'any' | 'none',
  lastIssues: number,
  ctx: SegmentContext,
): Where {
  const issueIds = ctx.recentIssueIds.slice(0, lastIssues)
  if (issueIds.length === 0) return op === 'any' ? NOTHING : {}
  const delivery: Prisma.CrmNewsletterIssueRecipientWhereInput = {
    issueId: { in: issueIds },
    [field]: { not: null },
  }
  return op === 'any'
    ? { deliveries: { some: delivery } }
    : { deliveries: { none: delivery } }
}

/** One condition → Prisma filter on the subscriber. */
export function compileCondition(
  condition: NewsletterSegmentCondition,
  ctx: SegmentContext,
): Where {
  switch (condition.type) {
    case 'source':
      return { source: { in: condition.sources } }
    case 'subscribed': {
      const day = saoPauloDayStart(condition.date)
      return condition.op === 'before'
        ? { createdAt: { lt: day } }
        : { createdAt: { gte: day } }
    }
    case 'confirmed':
      return condition.value
        ? { confirmedAt: { not: null } }
        : { confirmedAt: null }
    case 'opened':
      return engagement('openedAt', condition.op, condition.lastIssues, ctx)
    case 'clicked':
      return engagement('clickedAt', condition.op, condition.lastIssues, ctx)
    case 'neverOpened':
      return { lastOpenedAt: null }
    case 'lastOpenedBefore':
      return { lastOpenedAt: { lt: saoPauloDayStart(condition.date) } }
    case 'linkedPerson':
      return condition.value ? person() : notPerson()
    case 'company':
      return person({ companyId: { in: condition.companyIds } })
    case 'jobTitle':
      return person({ jobTitle: text(condition.op, condition.value) })
    case 'city':
      return person({ city: text(condition.op, condition.value) })
    case 'customField': {
      const ids = ctx.customFieldPersonIds[customFieldKey(condition)] ?? []
      return condition.op === 'isNotSet'
        ? notPerson({ id: { in: ids } })
        : person({ id: { in: ids } })
    }
    case 'openOpportunity':
      return condition.value
        ? person(HAS_OPEN_OPPORTUNITY)
        : notPerson(HAS_OPEN_OPPORTUNITY)
    case 'leadStage':
      return person({
        convertedFromLeads: {
          some: { deletedAt: null, stage: { in: condition.stages } },
        },
      })
  }
}

/**
 * The whole segment: AND of the top-level conditions and, for each group,
 * the OR of its conditions. An empty segment compiles to `{}`.
 */
export function compileNewsletterSegment(
  segment: NewsletterSegment,
  ctx: SegmentContext,
): Where {
  if (isEmptySegment(segment)) return {}
  return {
    AND: [
      ...segment.conditions.map((condition) =>
        compileCondition(condition, ctx),
      ),
      ...segment.groups.map((group) => ({
        OR: group.conditions.map((condition) =>
          compileCondition(condition, ctx),
        ),
      })),
    ],
  }
}

/** Filter of a custom field value for a resolved condition (repository). */
export function customFieldValueWhere(
  condition: CustomFieldCondition,
): Prisma.CrmCustomFieldValueWhereInput {
  if (condition.op === 'isSet' || condition.op === 'isNotSet') {
    return {
      NOT: [{ value: { equals: Prisma.JsonNull } }, { value: { equals: '' } }],
    }
  }
  if (condition.op === 'contains') {
    return { value: { string_contains: String(condition.value ?? '') } }
  }
  return { value: { equals: condition.value ?? '' } }
}

/**
 * Reads `CrmNewsletterIssue.segment`. Phase-1 issues store `{}`; anything
 * that no longer parses (a condition type removed later) falls back to
 * `null` so the caller can refuse the send instead of mailing everyone.
 */
export function parseStoredSegment(value: unknown): StoredIssueSegment | null {
  const parsed = StoredIssueSegmentSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : null
}
