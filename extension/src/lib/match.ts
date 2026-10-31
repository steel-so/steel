import { canonicalPhone, phonesMatch } from './phone'
import { linkedinProfile } from './extract'
import type { Contact, LeadMatch, LeadSummary, MatchReason } from './types'

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function reasonFor(lead: LeadSummary, contact: Contact): MatchReason | null {
  if (contact.phones.some((a) => lead.phones.some((b) => phonesMatch(a, b)))) {
    return 'phone'
  }
  const emails = new Set(contact.emails.map((email) => email.toLowerCase()))
  if (lead.emails.some((email) => emails.has(email.toLowerCase()))) return 'email'
  const slug = linkedinProfile(contact.linkedin)?.slug
  if (slug && linkedinProfile(lead.linkedin)?.slug === slug) return 'linkedin'
  return null
}

/**
 * Leads that are this contact. Phone, e-mail and LinkedIn are certain; a name is
 * only offered (with a "name" reason) when it has at least two words and nothing
 * stronger matched, because two people can share a first name.
 */
export function findMatches(leads: LeadSummary[], contact: Contact): LeadMatch[] {
  const strong: LeadMatch[] = []
  for (const lead of leads) {
    const reason = reasonFor(lead, contact)
    if (reason) strong.push({ lead, reason })
  }
  if (strong.length > 0) return strong
  const name = contact.name ? normalizeName(contact.name) : ''
  if (!name.includes(' ')) return []
  return leads
    .filter((lead) => normalizeName(lead.name) === name)
    .map((lead) => ({ lead, reason: 'name' as const }))
}

/**
 * Strings the history search looks for: the tickets this extension opens carry
 * them in the description, and the service desk searches title and description.
 */
export function ticketSearchTerms(contact: Contact): string[] {
  const terms: string[] = []
  for (const phone of contact.phones) {
    const canonical = canonicalPhone(phone)
    if (canonical) terms.push(canonical)
  }
  terms.push(...contact.emails.map((email) => email.toLowerCase()))
  const slug = linkedinProfile(contact.linkedin)?.slug
  if (slug) terms.push(slug)
  return [...new Set(terms)]
}
