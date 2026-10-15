import type { SiteBusinessProfileDTO } from '@/src/schemas/site-search.schema'

/**
 * The business profile ("Perfil do negócio") of a site: completeness, the
 * schema.org Organization/LocalBusiness node and the NAP (name, address,
 * phone) consistency check. Pure.
 */

type JsonLdNode = Record<string, unknown>

/** Fields that make an entity clear to engines, with their weight. */
const PROFILE_FIELDS: Array<{
  key: string
  label: string
  weight: number
  filled: (profile: SiteBusinessProfileDTO) => boolean
}> = [
  { key: 'name', label: 'nome', weight: 2, filled: (p) => Boolean(p.name) },
  {
    key: 'description',
    label: 'descrição',
    weight: 2,
    filled: (p) => Boolean(p.description),
  },
  {
    key: 'category',
    label: 'categoria',
    weight: 1,
    filled: (p) => Boolean(p.category || (p.type && p.type !== 'Organization')),
  },
  {
    key: 'phone',
    label: 'telefone',
    weight: 2,
    filled: (p) => Boolean(p.phone),
  },
  {
    key: 'address',
    label: 'endereço',
    weight: 2,
    filled: (p) =>
      Boolean(p.address?.city && (p.address.street || p.address.postalCode)),
  },
  { key: 'logo', label: 'logo', weight: 1, filled: (p) => Boolean(p.logoUrl) },
  {
    key: 'sameAs',
    label: 'perfis oficiais',
    weight: 1,
    filled: (p) => Boolean(p.sameAs?.length),
  },
  {
    key: 'hours',
    label: 'horário de funcionamento',
    weight: 1,
    filled: (p) => Boolean(p.hours?.length),
  },
  {
    key: 'foundingYear',
    label: 'ano de fundação',
    weight: 1,
    filled: (p) => p.foundingYear !== undefined,
  },
]

export interface ProfileCompleteness {
  /** 0–100. */
  percent: number
  /** pt-BR labels of what is missing, most important first. */
  missing: string[]
}

export function profileCompleteness(
  profile: SiteBusinessProfileDTO,
): ProfileCompleteness {
  const total = PROFILE_FIELDS.reduce((sum, field) => sum + field.weight, 0)
  let done = 0
  const missing: Array<{ label: string; weight: number }> = []
  for (const field of PROFILE_FIELDS) {
    if (field.filled(profile)) done += field.weight
    else missing.push({ label: field.label, weight: field.weight })
  }
  return {
    percent: Math.round((done / total) * 100),
    missing: missing
      .sort((a, b) => b.weight - a.weight)
      .map((field) => field.label),
  }
}

/** Types that are a place customers visit (or a local service area). */
export function isLocalBusiness(profile: SiteBusinessProfileDTO): boolean {
  return Boolean(
    profile.type &&
      profile.type !== 'Organization' &&
      profile.type !== 'EducationalOrganization',
  )
}

function postalAddress(profile: SiteBusinessProfileDTO): JsonLdNode | null {
  const address = profile.address
  if (!address) return null
  const node: JsonLdNode = {
    '@type': 'PostalAddress',
    ...(address.street ? { streetAddress: address.street } : {}),
    ...(address.city ? { addressLocality: address.city } : {}),
    ...(address.region ? { addressRegion: address.region } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    addressCountry: address.country || 'BR',
  }
  return Object.keys(node).length > 2 ? node : null
}

/** One-line address (`Rua X, 10 · Centro · São Paulo/SP · 01000-000`). */
export function formatAddress(profile: SiteBusinessProfileDTO): string {
  const address = profile.address
  if (!address) return ''
  const city = [address.city, address.region].filter(Boolean).join('/')
  return [address.street, address.district, city, address.postalCode]
    .filter(Boolean)
    .join(' · ')
}

const DAY_LABELS: Record<string, string> = {
  Monday: 'seg',
  Tuesday: 'ter',
  Wednesday: 'qua',
  Thursday: 'qui',
  Friday: 'sex',
  Saturday: 'sáb',
  Sunday: 'dom',
}

/** `seg, ter, qua: 08:00–18:00; sáb: 08:00–12:00`. */
export function formatHours(profile: SiteBusinessProfileDTO): string {
  return (profile.hours ?? [])
    .map(
      (slot) =>
        `${slot.days.map((day) => DAY_LABELS[day]).join(', ')}: ${slot.opens}–${slot.closes}`,
    )
    .join('; ')
}

/**
 * The Organization (or LocalBusiness subtype) node of every page. Missing
 * profile fields fall back to the site's SEO settings (name, logo,
 * profiles), then to the site name.
 */
export function businessNode(
  profile: SiteBusinessProfileDTO,
  options: {
    id: string
    siteUrl: string
    fallbackName: string
    logo?: string
    sameAs?: string[]
  },
): JsonLdNode {
  const local = isLocalBusiness(profile)
  const address = postalAddress(profile)
  const logo = profile.logoUrl ?? options.logo
  const sameAs = profile.sameAs?.length ? profile.sameAs : options.sameAs
  const people = profile.people ?? []
  return {
    '@type': profile.type ?? 'Organization',
    '@id': options.id,
    name: profile.name || options.fallbackName,
    url: options.siteUrl,
    ...(profile.legalName ? { legalName: profile.legalName } : {}),
    ...(profile.description ? { description: profile.description } : {}),
    ...(profile.category ? { knowsAbout: profile.category } : {}),
    ...(logo ? { logo, ...(local ? { image: logo } : {}) } : {}),
    ...(sameAs?.length ? { sameAs } : {}),
    ...(profile.phone ? { telephone: profile.phone } : {}),
    ...(profile.email ? { email: profile.email } : {}),
    ...(address ? { address } : {}),
    ...(profile.geo
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: profile.geo.latitude,
            longitude: profile.geo.longitude,
          },
        }
      : {}),
    ...(profile.hours?.length
      ? {
          openingHoursSpecification: profile.hours.map((slot) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: slot.days,
            opens: slot.opens,
            closes: slot.closes,
          })),
        }
      : {}),
    ...(profile.serviceArea?.length
      ? {
          areaServed: profile.serviceArea.map((name) => ({
            '@type': 'Place',
            name,
          })),
        }
      : {}),
    ...(profile.foundingYear
      ? { foundingDate: String(profile.foundingYear) }
      : {}),
    ...(people.length
      ? {
          employee: people.map((person) => ({
            '@type': 'Person',
            name: person.name,
            ...(person.role ? { jobTitle: person.role } : {}),
            ...(person.url ? { url: person.url } : {}),
          })),
        }
      : {}),
    ...(local && profile.priceRange ? { priceRange: profile.priceRange } : {}),
  }
}

/** Last 8 digits of a phone (local number without area/country code). */
function phoneKey(value: string): string {
  return value.replace(/\D/g, '').slice(-8)
}

/** Phone-like numbers written in a text. */
export function phonesIn(value: string): string[] {
  return (value.match(/\+?\(?\d[\d\s().-]{6,}\d/g) ?? [])
    .map(phoneKey)
    .filter((digits) => digits.length === 8)
}

export type NapStatus = 'consistent' | 'missing' | 'conflict' | 'no-profile'

/**
 * Whether the phone of the profile is the one the site shows (`text` is
 * everything readable: page, header and footer). A different number on
 * the site is a conflict; engines lose trust in both.
 */
export function napConsistency(
  profile: SiteBusinessProfileDTO,
  text: string,
): NapStatus {
  if (!profile.phone) return 'no-profile'
  const key = phoneKey(profile.phone)
  const shown = phonesIn(text)
  if (shown.includes(key)) return 'consistent'
  return shown.length ? 'conflict' : 'missing'
}
