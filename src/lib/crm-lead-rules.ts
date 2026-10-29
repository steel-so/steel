import type { CrmLeadRuleField, CrmLeadRuleOperator } from '@prisma/client'

export interface LeadRuleSubject {
  name: string
  emails: string[]
  phones: string[]
  company: string | null
  jobTitle: string | null
  source: string | null
  city: string | null
}

interface LeadRule {
  field: CrmLeadRuleField
  operator: CrmLeadRuleOperator
  value: string | null
}

function fieldValue(subject: LeadRuleSubject, field: CrmLeadRuleField): string {
  switch (field) {
    case 'name':
      return subject.name
    case 'email':
      return subject.emails[0] ?? ''
    case 'phone':
      return subject.phones[0] ?? ''
    case 'company':
      return subject.company ?? ''
    case 'jobTitle':
      return subject.jobTitle ?? ''
    case 'source':
      return subject.source ?? ''
    case 'city':
      return subject.city ?? ''
    // Engagement events are not lead fields (see `isLeadEventRuleField`).
    case 'newsletter_subscribed':
    case 'newsletter_opened':
    case 'newsletter_clicked':
      return ''
  }
}

const EVENT_RULE_FIELDS: ReadonlySet<CrmLeadRuleField> = new Set([
  'newsletter_subscribed',
  'newsletter_opened',
  'newsletter_clicked',
])

/** Event rules score engagement (newsletter bridge), not lead fields. */
export function isLeadEventRuleField(field: CrmLeadRuleField): boolean {
  return EVENT_RULE_FIELDS.has(field)
}

/**
 * Whether an event rule matches an engagement event. `newsletter_clicked`
 * with a value only matches a clicked URL containing it (case-insensitive).
 */
export function matchesLeadEventRule(
  rule: LeadRule & { active: boolean },
  event: { field: CrmLeadRuleField; url?: string | null },
): boolean {
  if (!rule.active || rule.field !== event.field) return false
  if (rule.field !== 'newsletter_clicked') return true
  const filter = rule.value?.trim().toLowerCase()
  if (!filter) return true
  return (event.url ?? '').toLowerCase().includes(filter)
}

export function matchesLeadRule(
  subject: LeadRuleSubject,
  rule: LeadRule,
): boolean {
  const actual = fieldValue(subject, rule.field)

  switch (rule.operator) {
    case 'equals':
      return actual === (rule.value ?? '')
    case 'not_equals':
      return actual !== (rule.value ?? '')
    case 'contains':
      return rule.value ? actual.includes(rule.value) : false
    case 'is_empty':
      return actual.trim().length === 0
    case 'is_not_empty':
      return actual.trim().length > 0
  }
}

export function computeLeadScore<
  T extends LeadRule & { points: number; active: boolean },
>(subject: LeadRuleSubject, rules: T[]): number {
  return rules
    .filter(
      (rule) =>
        rule.active &&
        !isLeadEventRuleField(rule.field) &&
        matchesLeadRule(subject, rule),
    )
    .reduce((total, rule) => total + rule.points, 0)
}

export function findLeadRoutingOwner<
  T extends LeadRule & { ownerId: string; active: boolean },
>(subject: LeadRuleSubject, rules: T[]): string | null {
  const match = rules.find(
    (rule) =>
      rule.active &&
      !isLeadEventRuleField(rule.field) &&
      matchesLeadRule(subject, rule),
  )
  return match?.ownerId ?? null
}
