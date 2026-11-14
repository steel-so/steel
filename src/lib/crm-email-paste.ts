export type PastedMember = { email: string; name?: string }

export type ParsedPastedEmails = {
  members: PastedMember[]
  /** Tokens that did not look like an e-mail address. */
  invalid: string[]
  /** Addresses that appeared more than once (or already exist). */
  duplicates: string[]
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
const NAMED_RE = /^(.*?)<\s*([^<>\s]+)\s*>$/

/**
 * Turns pasted text (one address per line, or separated by comma/semicolon,
 * "Name <a@b.com>" or CSV rows) into unique members. Never throws.
 */
export function parsePastedEmails(
  text: string,
  existing: Iterable<string> = [],
): ParsedPastedEmails {
  const seen = new Set<string>()
  for (const e of existing) seen.add(e.trim().toLowerCase())
  const members: PastedMember[] = []
  const invalid: string[] = []
  const duplicates: string[] = []

  const tokens = text
    .split(/[\n\r;,\t]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

  for (const token of tokens) {
    const named = NAMED_RE.exec(token)
    const email = (named ? named[2] : token).trim()
    const name = named ? named[1].trim().replace(/^["']|["']$/g, '') : ''
    if (!EMAIL_RE.test(email)) {
      // A CSV header or a name cell is noise, not an error worth showing twice.
      if (!invalid.includes(token)) invalid.push(token)
      continue
    }
    const key = email.toLowerCase()
    if (seen.has(key)) {
      if (!duplicates.includes(key)) duplicates.push(key)
      continue
    }
    seen.add(key)
    members.push(name ? { email, name } : { email })
  }
  return { members, invalid, duplicates }
}
