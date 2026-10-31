import { digitsOf, fullPhone, looksLikePhone } from './phone'
import type { Contact } from './types'

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const JID = /^(?:true|false)_(\d{8,15})@(?:c\.us|s\.whatsapp\.net)/

function clean(text: string | null | undefined): string | null {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value === '' ? null : value
}

/* -------------------------------- WhatsApp -------------------------------- */

/**
 * The `data-id` of a WhatsApp Web message row starts with the sender JID
 * (`false_5511912345678@c.us_3EB0…`). Group rows use `@g.us` and yield null.
 */
export function phoneFromMessageId(dataId: string | null | undefined): string | null {
  const match = JID.exec(dataId ?? '')
  return match?.[1] ? digitsOf(match[1]) : null
}

export interface WhatsAppInput {
  /** Text of the conversation header (name, or the number of an unsaved contact). */
  title: string | null | undefined
  /** `data-id` of any message row of the open conversation. */
  messageId: string | null | undefined
}

export function buildWhatsAppContact(input: WhatsAppInput): Contact | null {
  // A group has no single person behind it.
  if (/@g\.us/.test(input.messageId ?? '')) return null
  const title = clean(input.title)
  const fromJid = phoneFromMessageId(input.messageId)
  const fromTitle = title && looksLikePhone(title) ? fullPhone(title) : null
  const phone = fromJid ?? fromTitle
  const name = title && !looksLikePhone(title) ? title : null
  if (!phone && !name) return null
  return {
    source: 'whatsapp',
    name,
    phones: phone ? [phone] : [],
    emails: [],
    company: null,
    jobTitle: null,
    linkedin: null,
  }
}

/* ---------------------------------- Gmail --------------------------------- */

export interface MailAddress {
  email: string
  name: string | null
}

/** The Gmail tab title reads "Inbox (3) - you@example.com - Gmail". */
export function accountFromGmailTitle(title: string | null | undefined): string | null {
  const match = EMAIL.exec(title ?? '')
  return match ? match[0].toLowerCase() : null
}

function uniqueByEmail(list: MailAddress[]): MailAddress[] {
  const seen = new Set<string>()
  const out: MailAddress[] = []
  for (const item of list) {
    const email = item.email.trim().toLowerCase()
    if (!EMAIL.test(email) || seen.has(email)) continue
    seen.add(email)
    out.push({ email, name: clean(item.name) })
  }
  return out
}

/**
 * The person on the other side of the open thread: the latest sender who is not
 * the account owner; on a thread the owner wrote alone, the first recipient.
 */
export function buildGmailContact(input: {
  senders: MailAddress[]
  recipients: MailAddress[]
  account: string | null
}): Contact | null {
  const own = input.account?.toLowerCase() ?? null
  const senders = uniqueByEmail(input.senders).filter((item) => item.email !== own)
  const recipients = uniqueByEmail(input.recipients).filter((item) => item.email !== own)
  const person = senders.at(-1) ?? recipients[0]
  if (!person) return null
  return {
    source: 'gmail',
    name: person.name && person.name.toLowerCase() !== person.email ? person.name : null,
    phones: [],
    emails: [person.email],
    company: null,
    jobTitle: null,
    linkedin: null,
  }
}

/* --------------------------------- LinkedIn -------------------------------- */

export function linkedinProfile(href: string | null | undefined): { url: string; slug: string } | null {
  const match = /linkedin\.com\/in\/([^/?#]+)/i.exec(href ?? '')
  if (!match?.[1]) return null
  let slug = match[1]
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // Keep the raw slug when it is not valid percent-encoding.
  }
  slug = slug.toLowerCase()
  return { url: `https://www.linkedin.com/in/${slug}`, slug }
}

const HEADLINE_SEPARATORS = [
  /^(.*?)\s+(?:at|@)\s+(.+)$/i,
  /^(.*?)\s+(?:na|no)\s+(.+)$/i,
  /^(.*?)\s+(?:\||–|-)\s+(.+)$/,
  /^(.*?)\s+em\s+(.+)$/i,
]

/** "Gerente de Vendas na Stratus | Telecom" → title and company. */
export function splitHeadline(headline: string | null | undefined): {
  jobTitle: string | null
  company: string | null
} {
  const text = clean(headline)
  if (!text) return { jobTitle: null, company: null }
  // Most specific separator first: "Especialista em Redes na Vivo" must split at
  // "na", not at the "em" inside the job title.
  for (const separator of HEADLINE_SEPARATORS) {
    const match = separator.exec(text)
    if (!match?.[1] || !match[2]) continue
    const company = clean(match[2].split(/\s+[|·•]\s+/)[0])
    return { jobTitle: clean(match[1]), company }
  }
  return { jobTitle: text, company: null }
}

/** "(3) Maria Silva | LinkedIn" → "Maria Silva". */
export function nameFromLinkedinTitle(title: string | null | undefined): string | null {
  return clean((title ?? '').replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*LinkedIn\s*$/i, ''))
}

export function buildLinkedinContact(input: {
  href: string | null | undefined
  name: string | null | undefined
  headline: string | null | undefined
}): Contact | null {
  const profile = linkedinProfile(input.href)
  if (!profile) return null
  const { jobTitle, company } = splitHeadline(input.headline)
  return {
    source: 'linkedin',
    name: clean(input.name),
    phones: [],
    emails: [],
    company,
    jobTitle,
    linkedin: profile.url,
  }
}

/** Stable key used to skip re-sending an unchanged contact. */
export function contactKey(contact: Contact | null): string {
  return contact ? JSON.stringify(contact) : ''
}
