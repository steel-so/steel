import type { Prisma } from '@prisma/client'
import {
  allSegmentConditions,
  type CrmSegmentCondition,
  type CrmSegmentDefinition,
  type CrmSegmentTarget,
  isEmptySegmentDefinition,
} from '@/src/schemas/crm-segment.schema'

/**
 * Pure compiler of a contact segment into a Prisma `where` for the target
 * model (people, leads or companies). Rules that Prisma cannot express as a
 * nested filter (custom field values, activity, campaign engagement, list
 * membership, opt-outs) are resolved first by the repository into id/e-mail
 * sets, keyed by `conditionKey`, and handed in through `SegmentContext`.
 */

export type ResolvedSet = {
  personIds: string[]
  leadIds: string[]
  companyIds: string[]
  /** Lower-case e-mails. */
  emails: string[]
}

export type SegmentContext = {
  sets: Record<string, ResolvedSet>
  now: Date
}

export const EMPTY_RESOLVED_SET: ResolvedSet = {
  personIds: [],
  leadIds: [],
  companyIds: [],
  emails: [],
}

export const OPT_OUT_KEY = 'optout'

type Where = Record<string, unknown>

const DAY_MS = 24 * 60 * 60 * 1000

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/** Key of the set a rule needs resolved, or `null` when it needs none. */
export function conditionKey(condition: CrmSegmentCondition): string | null {
  switch (condition.type) {
    case 'customField': {
      const op = condition.op === 'isNotSet' ? 'isSet' : condition.op
      const value =
        op === 'isSet'
          ? ''
          : JSON.stringify(condition.value ?? null).toLowerCase()
      return `cf|${condition.definitionId}|${op}|${value}`
    }
    case 'activity':
      return `act|${condition.days}`
    case 'emailEngagement':
      return `mail|${condition.event}|${condition.days}`
    case 'campaign':
      return `camp|${[...condition.campaignIds].sort().join(',')}`
    case 'mailingList':
      return `list|${[...condition.listIds].sort().join(',')}`
    case 'consent':
      return condition.value === 'emailOptedOut' ||
        condition.value === 'emailAllowed'
        ? OPT_OUT_KEY
        : null
    default:
      return null
  }
}

/** Distinct rules (by key) the repository must resolve before compiling. */
export function segmentNeeds(
  def: CrmSegmentDefinition,
): { key: string; condition: CrmSegmentCondition }[] {
  const needs = new Map<
    string,
    { key: string; condition: CrmSegmentCondition }
  >()
  for (const condition of allSegmentConditions(def)) {
    const key = conditionKey(condition)
    if (key && !needs.has(key)) needs.set(key, { key, condition })
  }
  return [...needs.values()]
}

function setOf(ctx: SegmentContext, key: string | null): ResolvedSet {
  return (key && ctx.sets[key]) || EMPTY_RESOLVED_SET
}

const COLUMN_BY_FIELD: Record<string, string> = {
  email: 'emails',
  phone: 'phones',
}

/** Columns that are `String` (not nullable) on every target. */
const NON_NULLABLE = new Set(['name'])

function textWhere(
  field: string,
  op: 'equals' | 'contains' | 'isSet' | 'isNotSet',
  rawValue: string | undefined,
): Where {
  const column = COLUMN_BY_FIELD[field] ?? field
  const value = (rawValue ?? '').trim()
  if (field === 'email' || field === 'phone') {
    if (op === 'isSet') return { NOT: { [column]: { isEmpty: true } } }
    if (op === 'isNotSet') return { [column]: { isEmpty: true } }
    return {
      [column]: { has: field === 'email' ? value.toLowerCase() : value },
    }
  }
  const nullable = !NON_NULLABLE.has(field)
  if (op === 'isSet') {
    return nullable
      ? { AND: [{ [column]: { not: null } }, { NOT: { [column]: '' } }] }
      : { NOT: { [column]: '' } }
  }
  if (op === 'isNotSet') {
    return nullable
      ? { OR: [{ [column]: null }, { [column]: '' }] }
      : { [column]: '' }
  }
  return op === 'equals'
    ? { [column]: { equals: value, mode: 'insensitive' } }
    : { [column]: { contains: value, mode: 'insensitive' } }
}

function numberWhere(
  field: string,
  op: 'gte' | 'lte' | 'eq',
  value: number,
): Where {
  return op === 'eq' ? { [field]: value } : { [field]: { [op]: value } }
}

function negate(where: Where): Where {
  return { NOT: where }
}

function opportunityFilter(
  condition: Extract<CrmSegmentCondition, { type: 'deals' }>,
  now: Date,
): Prisma.CrmOpportunityWhereInput {
  const filter: Prisma.CrmOpportunityWhereInput = {
    deletedAt: null,
    stage: { is: { category: condition.kind === 'won' ? 'WON' : 'OPEN' } },
  }
  if (condition.kind === 'won' && condition.withinDays) {
    filter.wonAt = { gte: daysAgo(now, condition.withinDays) }
  }
  return filter
}

function compilePerson(
  condition: CrmSegmentCondition,
  ctx: SegmentContext,
): Where {
  const key = conditionKey(condition)
  const set = setOf(ctx, key)
  switch (condition.type) {
    case 'text':
      return textWhere(condition.field, condition.op, condition.value)
    case 'owner':
      return condition.op === 'in'
        ? {
            company: {
              is: {
                deletedAt: null,
                accountOwnerId: { in: condition.userIds },
              },
            },
          }
        : {
            OR: [
              { companyId: null },
              { company: { is: { accountOwnerId: null } } },
            ],
          }
    case 'company':
      return { companyId: { in: condition.companyIds } }
    case 'createdAt': {
      const since = daysAgo(ctx.now, condition.days)
      return condition.op === 'withinDays'
        ? { createdAt: { gte: since } }
        : { createdAt: { lt: since } }
    }
    case 'customField':
      return condition.op === 'isNotSet'
        ? negate({ id: { in: set.personIds } })
        : { id: { in: set.personIds } }
    case 'activity':
      return condition.op === 'withinDays'
        ? { id: { in: set.personIds } }
        : negate({ id: { in: set.personIds } })
    case 'emailEngagement':
      return condition.op === 'any'
        ? { id: { in: set.personIds } }
        : negate({ id: { in: set.personIds } })
    case 'campaign':
      return condition.op === 'in'
        ? { id: { in: set.personIds } }
        : negate({ id: { in: set.personIds } })
    case 'mailingList': {
      const member = {
        OR: [
          { id: { in: set.personIds } },
          { emails: { hasSome: set.emails } },
        ],
      }
      return condition.op === 'in' ? member : negate(member)
    }
    case 'deals': {
      const opp = opportunityFilter(condition, ctx.now)
      const companyHas = {
        company: { is: { deletedAt: null, opportunities: { some: opp } } },
      }
      if (condition.has) {
        return {
          OR: [{ opportunitiesAsPointOfContact: { some: opp } }, companyHas],
        }
      }
      return {
        AND: [
          { opportunitiesAsPointOfContact: { none: opp } },
          { OR: [{ companyId: null }, negate(companyHas)] },
        ],
      }
    }
    case 'consent':
      return consentWhere(condition.value, set, 'PERSON')
    default:
      return {}
  }
}

function consentWhere(
  value: string,
  set: ResolvedSet,
  target: CrmSegmentTarget,
): Where {
  if (value === 'hasEmail') return { NOT: { emails: { isEmpty: true } } }
  if (value === 'hasPhone') return { NOT: { phones: { isEmpty: true } } }
  const optedOut: Where = {
    OR: [
      { emails: { hasSome: set.emails } },
      ...(target === 'PERSON' ? [{ id: { in: set.personIds } }] : []),
      ...(target === 'LEAD'
        ? [{ convertedPersonId: { in: set.personIds } }]
        : []),
    ],
  }
  return value === 'emailOptedOut' ? optedOut : negate(optedOut)
}

function compileLead(
  condition: CrmSegmentCondition,
  ctx: SegmentContext,
): Where {
  const set = setOf(ctx, conditionKey(condition))
  switch (condition.type) {
    case 'text':
      return textWhere(condition.field, condition.op, condition.value)
    case 'number':
      return numberWhere(condition.field, condition.op, condition.value)
    case 'leadStage':
      return { stage: { in: condition.stages } }
    case 'owner':
      return condition.op === 'in'
        ? { ownerId: { in: condition.userIds } }
        : { ownerId: null }
    case 'createdAt': {
      const since = daysAgo(ctx.now, condition.days)
      return condition.op === 'withinDays'
        ? { createdAt: { gte: since } }
        : { createdAt: { lt: since } }
    }
    case 'emailEngagement':
    case 'campaign': {
      const member = {
        OR: [
          { id: { in: set.leadIds } },
          { convertedPersonId: { in: set.personIds } },
        ],
      }
      const positive =
        condition.type === 'emailEngagement'
          ? condition.op === 'any'
          : condition.op === 'in'
      return positive ? member : negate(member)
    }
    case 'mailingList': {
      const member = {
        OR: [
          { emails: { hasSome: set.emails } },
          { convertedPersonId: { in: set.personIds } },
        ],
      }
      return condition.op === 'in' ? member : negate(member)
    }
    case 'consent':
      return consentWhere(condition.value, set, 'LEAD')
    default:
      return {}
  }
}

function compileCompany(
  condition: CrmSegmentCondition,
  ctx: SegmentContext,
): Where {
  const set = setOf(ctx, conditionKey(condition))
  switch (condition.type) {
    case 'text':
      return textWhere(condition.field, condition.op, condition.value)
    case 'number':
      return numberWhere(condition.field, condition.op, condition.value)
    case 'owner':
      return condition.op === 'in'
        ? { accountOwnerId: { in: condition.userIds } }
        : { accountOwnerId: null }
    case 'createdAt': {
      const since = daysAgo(ctx.now, condition.days)
      return condition.op === 'withinDays'
        ? { createdAt: { gte: since } }
        : { createdAt: { lt: since } }
    }
    case 'customField':
      return condition.op === 'isNotSet'
        ? negate({ id: { in: set.companyIds } })
        : { id: { in: set.companyIds } }
    case 'activity':
      return condition.op === 'withinDays'
        ? { id: { in: set.companyIds } }
        : negate({ id: { in: set.companyIds } })
    case 'deals': {
      const opp = opportunityFilter(condition, ctx.now)
      return condition.has
        ? { opportunities: { some: opp } }
        : { opportunities: { none: opp } }
    }
    case 'consent':
      return consentWhere(condition.value, set, 'COMPANY')
    default:
      return {}
  }
}

function compileCondition(
  target: CrmSegmentTarget,
  condition: CrmSegmentCondition,
  ctx: SegmentContext,
): Where {
  if (target === 'PERSON') return compilePerson(condition, ctx)
  if (target === 'LEAD') return compileLead(condition, ctx)
  return compileCompany(condition, ctx)
}

function combine(match: 'ALL' | 'ANY', parts: Where[]): Where {
  if (parts.length === 0) return {}
  return match === 'ALL' ? { AND: parts } : { OR: parts }
}

/**
 * The filter of the segment's rules alone (workspace and soft-delete are
 * added by `segmentWhere`). An empty segment compiles to `{}`.
 */
export function compileSegmentRules(
  target: CrmSegmentTarget,
  def: CrmSegmentDefinition,
  ctx: SegmentContext,
): Where {
  if (isEmptySegmentDefinition(def)) return {}
  const parts: Where[] = [
    ...def.conditions.map((c) => compileCondition(target, c, ctx)),
    ...def.groups.map((group) =>
      combine(
        group.match,
        group.conditions.map((c) => compileCondition(target, c, ctx)),
      ),
    ),
  ]
  return combine(def.match, parts)
}

/** Full `where` for the target model: workspace + not deleted + the rules. */
export function segmentWhere(
  workspaceId: string,
  target: CrmSegmentTarget,
  def: CrmSegmentDefinition,
  ctx: SegmentContext,
): Where {
  return {
    AND: [
      { workspaceId, deletedAt: null },
      compileSegmentRules(target, def, ctx),
    ],
  }
}
