import type { CrmCompanyAddress } from '@/types/crm-company'
import type { CnpjPartner, CnpjProfile, CnpjSecondaryCnae } from './provider'

/**
 * Combines the profiles several public sources returned for the same CNPJ:
 * each field comes from the first source (in priority order) that has it,
 * lists are the union of all sources, and the address is taken as a whole
 * from one source so two different registrations never mix.
 */

const blank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim() === ''

function firstText(
  profiles: CnpjProfile[],
  pick: (profile: CnpjProfile) => string | null,
): string | null {
  for (const profile of profiles) {
    const value = pick(profile)
    if (!blank(value)) return value
  }
  return null
}

/** A positive capital wins over a 0 some sources print for "unknown". */
function capital(profiles: CnpjProfile[]): number | null {
  const values = profiles
    .map((p) => p.shareCapital)
    .filter((v): v is number => v !== null)
  return values.find((v) => v > 0) ?? values[0] ?? null
}

const key = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

function mergePartners(profiles: CnpjProfile[]): CnpjPartner[] {
  const byName = new Map<string, CnpjPartner>()
  for (const partner of profiles.flatMap((p) => p.partners)) {
    const id = key(partner.name)
    const known = byName.get(id)
    if (!known) {
      byName.set(id, { ...partner })
      continue
    }
    known.qualification ??= partner.qualification
    known.enteredAt ??= partner.enteredAt
  }
  return [...byName.values()]
}

function mergeCnaes(profiles: CnpjProfile[]): CnpjSecondaryCnae[] {
  const byCode = new Map<string, CnpjSecondaryCnae>()
  for (const cnae of profiles.flatMap((p) => p.secondaryCnaes)) {
    const known = byCode.get(cnae.code)
    if (!known) byCode.set(cnae.code, { ...cnae })
    else if (blank(known.description)) known.description = cnae.description
  }
  return [...byCode.values()]
}

const digits = (value: string | undefined): string =>
  (value ?? '').replace(/\D/g, '')

const ADDRESS_FIELDS = [
  'zipCode',
  'street',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
] as const

const hasCore = (a: CrmCompanyAddress): boolean =>
  Boolean(a.street && a.city && a.state)

/**
 * The address of the first source that has street, city and state; gaps are
 * filled only from sources with the same ZIP (or no ZIP to compare), so a
 * stale source cannot graft an old number onto a new street.
 */
function mergeAddress(profiles: CnpjProfile[]): CrmCompanyAddress | null {
  const addresses = profiles
    .map((p) => p.address)
    .filter((a): a is CrmCompanyAddress => a !== null)
  if (addresses.length === 0) return null
  const base = addresses.find(hasCore) ?? addresses[0]
  if (!base) return null
  const merged: CrmCompanyAddress = { ...base }
  const zip = digits(base.zipCode)
  for (const other of addresses) {
    if (other === base) continue
    const otherZip = digits(other.zipCode)
    if (zip && otherZip && zip !== otherZip) continue
    for (const field of ADDRESS_FIELDS) {
      if (blank(merged[field]) && !blank(other[field])) {
        merged[field] = other[field]
      }
    }
  }
  return merged
}

/** Profiles in priority order (best source first); at least one. */
export function mergeCnpjProfiles(profiles: CnpjProfile[]): CnpjProfile {
  const [first] = profiles
  if (!first) throw new Error('mergeCnpjProfiles needs at least one profile')
  if (profiles.length === 1) return first
  return {
    cnpj: first.cnpj,
    legalName: firstText(profiles, (p) => p.legalName),
    tradeName: firstText(profiles, (p) => p.tradeName),
    cnaeCode: firstText(profiles, (p) => p.cnaeCode),
    cnaeDescription: firstText(profiles, (p) => p.cnaeDescription),
    secondaryCnaes: mergeCnaes(profiles),
    size: profiles.find((p) => p.size !== null)?.size ?? null,
    legalNature: firstText(profiles, (p) => p.legalNature),
    registrationStatus: firstText(profiles, (p) => p.registrationStatus),
    openedAt: firstText(profiles, (p) => p.openedAt),
    shareCapital: capital(profiles),
    partners: mergePartners(profiles),
    address: mergeAddress(profiles),
  }
}
