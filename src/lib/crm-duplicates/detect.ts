import {
  cnpjKey,
  domainKey,
  emailKey,
  isGenericEmail,
  nameSimilarity,
  normalizeCompanyName,
  normalizeName,
  phoneKey,
} from './normalize'

export type DuplicateReason = 'email' | 'phone' | 'name' | 'cnpj' | 'domain'

export interface PersonRecord {
  id: string
  name: string
  emails: string[]
  phones: string[]
  companyId: string | null
}

export interface CompanyRecord {
  id: string
  name: string
  cnpj: string | null
  domain: string | null
}

export interface DuplicatePair {
  /** Ordered: `leftId` < `rightId`. */
  leftId: string
  rightId: string
  score: number
  reasons: DuplicateReason[]
}

/** Minimum name similarity (0..1) to propose a pair by name alone. */
export const NAME_THRESHOLD = 0.9
/** Looser bar when both records belong to the same company. */
export const NAME_THRESHOLD_SAME_COMPANY = 0.82
/** Pairs below this score are not proposed. */
export const MIN_SCORE = 60
/** Fuzzy name blocks larger than this only compare identical names. */
const MAX_BLOCK = 300

interface Signals {
  reasons: Set<DuplicateReason>
  base: number
  /** Same company (people) bonus. */
  bonus: number
}

interface Item {
  id: string
  name: string
  /** Block keys that make a pair worth comparing. */
  exact: Array<{ key: string; reason: DuplicateReason; weight: number }>
  nameKey: string
  companyId: string | null
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function prefixes(name: string): string[] {
  const tokens = name.split(' ').filter(Boolean)
  if (tokens.length === 0) return []
  const first = tokens[0].slice(0, 3)
  const last = tokens[tokens.length - 1].slice(0, 3)
  return first === last ? [first] : [first, last]
}

function personItem(person: PersonRecord): Item {
  const exact: Item['exact'] = []
  for (const raw of person.emails) {
    const key = emailKey(raw)
    if (key) {
      exact.push({
        key: `e:${key}`,
        reason: 'email',
        weight: isGenericEmail(key) ? 55 : 95,
      })
    }
  }
  for (const raw of person.phones) {
    const key = phoneKey(raw)
    if (key) exact.push({ key: `p:${key}`, reason: 'phone', weight: 85 })
  }
  return {
    id: person.id,
    name: person.name,
    exact,
    nameKey: normalizeName(person.name),
    companyId: person.companyId,
  }
}

function companyItem(company: CompanyRecord): Item {
  const exact: Item['exact'] = []
  const cnpj = cnpjKey(company.cnpj)
  if (cnpj) exact.push({ key: `c:${cnpj}`, reason: 'cnpj', weight: 100 })
  const domain = domainKey(company.domain)
  if (domain) exact.push({ key: `d:${domain}`, reason: 'domain', weight: 90 })
  return {
    id: company.id,
    name: company.name,
    exact,
    nameKey: normalizeCompanyName(company.name),
    companyId: null,
  }
}

function collect(
  items: Item[],
  nameWeight: (similarity: number) => number,
  sameCompanyBonus: boolean,
): DuplicatePair[] {
  const found = new Map<string, Signals & { left: string; right: string }>()

  const touch = (a: Item, b: Item): Signals => {
    const [left, right] = pairKey(a.id, b.id)
    const key = `${left}|${right}`
    let signals = found.get(key)
    if (!signals) {
      signals = {
        reasons: new Set(),
        base: 0,
        bonus: 0,
        left,
        right,
      }
      found.set(key, signals)
    }
    return signals
  }

  // Exact keys (e-mail, phone, CNPJ, domain).
  const byKey = new Map<string, Array<{ item: Item; weight: number; reason: DuplicateReason }>>()
  for (const item of items) {
    for (const entry of item.exact) {
      const list = byKey.get(entry.key) ?? []
      if (!list.some((existing) => existing.item.id === item.id)) {
        list.push({ item, weight: entry.weight, reason: entry.reason })
      }
      byKey.set(entry.key, list)
    }
  }
  for (const list of byKey.values()) {
    if (list.length < 2 || list.length > MAX_BLOCK) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const signals = touch(list[i].item, list[j].item)
        signals.reasons.add(list[i].reason)
        signals.base = Math.max(signals.base, list[i].weight)
      }
    }
  }

  // Fuzzy names inside prefix blocks.
  const blocks = new Map<string, Item[]>()
  for (const item of items) {
    if (item.nameKey.length < 3) continue
    for (const prefix of prefixes(item.nameKey)) {
      const list = blocks.get(prefix) ?? []
      list.push(item)
      blocks.set(prefix, list)
    }
  }
  const compared = new Set<string>()
  for (const list of blocks.values()) {
    const oversize = list.length > MAX_BLOCK
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const [left, right] = pairKey(a.id, b.id)
        const key = `${left}|${right}`
        if (compared.has(key)) continue
        compared.add(key)
        if (oversize && a.nameKey !== b.nameKey) continue
        const similarity = nameSimilarity(a.nameKey, b.nameKey)
        const sameCompany =
          sameCompanyBonus && a.companyId !== null && a.companyId === b.companyId
        const threshold = sameCompany ? NAME_THRESHOLD_SAME_COMPANY : NAME_THRESHOLD
        if (similarity < threshold) continue
        const signals = touch(a, b)
        signals.reasons.add('name')
        signals.base = Math.max(signals.base, nameWeight(similarity))
        if (sameCompany) signals.bonus = 10
      }
    }
  }

  const pairs: DuplicatePair[] = []
  for (const signals of found.values()) {
    const extra = Math.max(0, signals.reasons.size - 1) * 5
    const score = Math.min(100, signals.base + extra + signals.bonus)
    if (score < MIN_SCORE) continue
    pairs.push({
      leftId: signals.left,
      rightId: signals.right,
      score,
      reasons: [...signals.reasons].sort(),
    })
  }
  return pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.leftId.localeCompare(b.leftId) ||
      a.rightId.localeCompare(b.rightId),
  )
}

/** Name alone: 0.90 -> 63 ... 1.00 -> 70. */
const nameWeight = (similarity: number) => Math.round(similarity * 70)

export function findPersonDuplicates(people: PersonRecord[]): DuplicatePair[] {
  return collect(people.map(personItem), nameWeight, true)
}

export function findCompanyDuplicates(
  companies: CompanyRecord[],
): DuplicatePair[] {
  return collect(companies.map(companyItem), nameWeight, false)
}

/** Pairs that involve one record (arrival check): same rules, one probe. */
export function findPersonMatches(
  probe: PersonRecord,
  others: PersonRecord[],
): DuplicatePair[] {
  return findPersonDuplicates([probe, ...others.filter((o) => o.id !== probe.id)]).filter(
    (pair) => pair.leftId === probe.id || pair.rightId === probe.id,
  )
}

export function findCompanyMatches(
  probe: CompanyRecord,
  others: CompanyRecord[],
): DuplicatePair[] {
  return findCompanyDuplicates([probe, ...others.filter((o) => o.id !== probe.id)]).filter(
    (pair) => pair.leftId === probe.id || pair.rightId === probe.id,
  )
}
