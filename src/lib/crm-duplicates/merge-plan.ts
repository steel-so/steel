import { phoneKey } from './normalize'

/**
 * Field-level plan of a merge (C7). The survivor keeps what it has, gets
 * what it lacks from the archived record, and the multi-value columns
 * (e-mails, phones) are united. The plan is pure data: the repository writes
 * it and stores the "before" half so the merge can be undone.
 */

export interface PersonFields {
  name: string
  emails: string[]
  phones: string[]
  city: string | null
  jobTitle: string | null
  linkedin: string | null
  avatar: string | null
  companyId: string | null
}

export interface CompanyFields {
  name: string
  cnpj: string | null
  domain: string | null
  employees: number | null
  linkedin: string | null
  address: unknown
  arr: string | null
  icp: boolean
  accountOwnerId: string | null
}

export interface FieldPlan {
  /** Values written on the survivor (only what changes). */
  after: Record<string, unknown>
  /** What those columns held before. */
  before: Record<string, unknown>
}

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '')

function uniteEmails(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const email of [...a, ...b]) {
    const key = email.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(email.trim())
  }
  return out
}

function unitePhones(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const phone of [...a, ...b]) {
    const key = phoneKey(phone) ?? phone.replace(/\D/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(phone.trim())
  }
  return out
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function planPersonMerge(
  survivor: PersonFields,
  merged: PersonFields,
): FieldPlan {
  const after: Record<string, unknown> = {}
  const before: Record<string, unknown> = {}

  const emails = uniteEmails(survivor.emails, merged.emails)
  if (!sameList(emails, survivor.emails)) {
    before.emails = survivor.emails
    after.emails = emails
  }
  const phones = unitePhones(survivor.phones, merged.phones)
  if (!sameList(phones, survivor.phones)) {
    before.phones = survivor.phones
    after.phones = phones
  }
  for (const key of [
    'city',
    'jobTitle',
    'linkedin',
    'avatar',
    'companyId',
  ] as const) {
    if (isEmpty(survivor[key]) && !isEmpty(merged[key])) {
      before[key] = survivor[key]
      after[key] = merged[key]
    }
  }
  return { after, before }
}

export function planCompanyMerge(
  survivor: CompanyFields,
  merged: CompanyFields,
): FieldPlan {
  const after: Record<string, unknown> = {}
  const before: Record<string, unknown> = {}
  for (const key of [
    'cnpj',
    'domain',
    'employees',
    'linkedin',
    'address',
    'arr',
    'accountOwnerId',
  ] as const) {
    if (isEmpty(survivor[key]) && !isEmpty(merged[key])) {
      before[key] = survivor[key]
      after[key] = merged[key]
    }
  }
  if (!survivor.icp && merged.icp) {
    before.icp = false
    after.icp = true
  }
  return { after, before }
}
