import type { CrmCnpjAppliedField } from '@/types/crm-cnpj'
import type { CrmCompanyAddress } from '@/types/crm-company'
import type { CnpjProfile } from './provider'

/** Names the grid fills in when the CNPJ lookup failed at creation time. */
const PLACEHOLDER_NAME = /^Empresa [\d./-]+$/

/** Mailbox providers: their domain says nothing about the company. */
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.br',
  'outlook.com',
  'outlook.com.br',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'icloud.com',
  'me.com',
  'ig.com.br',
  'globo.com',
  'globomail.com',
  'protonmail.com',
  'proton.me',
  'zipmail.com.br',
  'r7.com',
  'oi.com.br',
  'aol.com',
])

/** The slice of `CrmCompany` the patch reads (works for Prisma rows too). */
export type CompanyPatchSource = {
  name: string
  domain: string | null
  address: unknown
  legalName: string | null
  tradeName: string | null
  emails: string[]
  phones: string[]
  cnaeCode: string | null
  cnaeDescription: string | null
  size: string | null
  legalNature: string | null
  registrationStatus: string | null
  openedAt: Date | null
  shareCapital: unknown
}

/** Columns the enrichment may write (repository `update` input shape). */
export type CompanyPatchData = {
  name?: string
  address?: CrmCompanyAddress
  legalName?: string
  tradeName?: string
  emails?: string[]
  phones?: string[]
  cnaeCode?: string
  cnaeDescription?: string
  size?: 'ME' | 'EPP' | 'DEMAIS'
  legalNature?: string
  registrationStatus?: string
  /** ISO date (`YYYY-MM-DD`). */
  openedAt?: string
  shareCapital?: number
}

export type CompanyPatch = {
  data: CompanyPatchData
  /** Fields that really change (`domain` is added by the service). */
  applied: CrmCnpjAppliedField[]
  /** Domain derived from a non-generic e-mail; the service checks it is free. */
  domainCandidate: string | null
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function hasAddress(address: unknown): boolean {
  return (
    typeof address === 'object' &&
    address !== null &&
    Object.values(address).some((v) => typeof v === 'string' && v.trim() !== '')
  )
}

function sameAddress(a: unknown, b: CrmCompanyAddress): boolean {
  if (typeof a !== 'object' || a === null) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const k of keys) {
    if ((x[k] ?? '') !== (y[k] ?? '')) return false
  }
  return true
}

const lower = (v: string) => v.trim().toLowerCase()
const emailKey = lower
const digitsOf = (v: string) => v.replace(/\D/g, '')

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Existing values first (kept as typed), then new ones, deduplicated by `key`.
 * Incoming values go through `normalize`; `key` must be case-insensitive for
 * e-mails and digits-only for phones.
 */
function union(
  current: string[],
  incoming: string[],
  key: (v: string) => string,
  normalize: (v: string) => string = (v) => v.trim(),
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (value: string) => {
    const k = key(value)
    if (k === '' || seen.has(k)) return
    seen.add(k)
    out.push(value)
  }
  for (const raw of current) push(raw.trim())
  for (const raw of incoming) push(normalize(raw))
  return out
}

export function isGenericEmailDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}

/** Domain of the first e-mail that is not from a mailbox provider. */
export function domainFromEmails(emails: string[]): string | null {
  for (const email of emails) {
    const domain = email.split('@')[1]?.trim().toLowerCase()
    if (domain?.includes('.') && !isGenericEmailDomain(domain)) {
      return domain
    }
  }
  return null
}

/**
 * What the Receita profile changes on a company. Manual values are never
 * touched unless `overwrite`; e-mails and phones are merged, not replaced
 * (unless `overwrite`). Pure: no I/O.
 */
export function companyPatchFromProfile(
  company: CompanyPatchSource,
  profile: CnpjProfile,
  overwrite: boolean,
): CompanyPatch {
  const data: CompanyPatchData = {}
  const applied: CrmCnpjAppliedField[] = []

  const fillText = (
    field: 'legalName' | 'tradeName' | 'legalNature' | 'registrationStatus',
    incoming: string | null,
  ) => {
    const value = incoming?.trim()
    if (!value) return
    const current = company[field]
    if (isBlank(current) || (overwrite && current !== value)) {
      data[field] = value
      applied.push(field)
    }
  }

  const name = (profile.tradeName ?? profile.legalName)?.trim()
  if (name) {
    const current = company.name.trim()
    const blank = current === '' || PLACEHOLDER_NAME.test(current)
    if (blank || (overwrite && current !== name)) {
      data.name = name
      applied.push('name')
    }
  }

  if (
    profile.address &&
    (!hasAddress(company.address) ||
      (overwrite && !sameAddress(company.address, profile.address)))
  ) {
    data.address = profile.address
    applied.push('address')
  }

  fillText('legalName', profile.legalName)
  fillText('tradeName', profile.tradeName)

  const code = profile.cnaeCode?.trim()
  const description = profile.cnaeDescription?.trim()
  if (code || description) {
    const codeChange =
      code &&
      (isBlank(company.cnaeCode) || (overwrite && company.cnaeCode !== code))
    const descChange =
      description &&
      (isBlank(company.cnaeDescription) ||
        (overwrite && company.cnaeDescription !== description))
    if (codeChange) data.cnaeCode = code
    if (descChange) data.cnaeDescription = description
    if (codeChange || descChange) applied.push('cnae')
  }

  if (
    profile.size &&
    (!company.size || (overwrite && company.size !== profile.size))
  ) {
    data.size = profile.size
    applied.push('size')
  }

  fillText('legalNature', profile.legalNature)
  fillText('registrationStatus', profile.registrationStatus)

  if (profile.openedAt) {
    const current = company.openedAt?.toISOString().slice(0, 10) ?? null
    if (current === null || (overwrite && current !== profile.openedAt)) {
      data.openedAt = profile.openedAt
      applied.push('openedAt')
    }
  }

  if (profile.shareCapital !== null && profile.shareCapital !== undefined) {
    const current =
      company.shareCapital === null || company.shareCapital === undefined
        ? null
        : Number(company.shareCapital)
    if (current === null || (overwrite && current !== profile.shareCapital)) {
      data.shareCapital = profile.shareCapital
      applied.push('shareCapital')
    }
  }

  const profileEmails = profile.emails ?? []
  const profilePhones = profile.phones ?? []

  if (profileEmails.length > 0) {
    const next = overwrite
      ? union([], profileEmails, emailKey, lower)
      : union(company.emails, profileEmails, emailKey, lower)
    if (!sameList(next, company.emails)) {
      data.emails = next
      applied.push('emails')
    }
  }

  if (profilePhones.length > 0) {
    const next = overwrite
      ? union([], profilePhones, digitsOf)
      : union(company.phones, profilePhones, digitsOf)
    if (!sameList(next, company.phones)) {
      data.phones = next
      applied.push('phones')
    }
  }

  const domainCandidate = isBlank(company.domain)
    ? domainFromEmails(data.emails ?? company.emails)
    : null

  return { data, applied, domainCandidate }
}
