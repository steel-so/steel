import { toCampaignWaId } from './phone'

/**
 * Audience snapshot of a campaign: CRM candidates (people, leads, mailing
 * list members) → one row per contact with the state of each channel.
 * Pure — the repositories collect candidates and opt-outs, this decides.
 */

export interface CampaignCandidate {
  personId?: string | null
  leadId?: string | null
  name: string
  email?: string | null
  phone?: string | null
}

export interface CampaignOptOutIndex {
  /** Lower-case e-mails opted out of CRM e-mail campaigns. */
  emails: Set<string>
  /** People opted out of CRM e-mail campaigns. */
  personIds: Set<string>
  /** WhatsApp numbers (waId) opted out of broadcasts (SAIR/PARAR...). */
  waIds: Set<string>
}

export type ChannelState = {
  status: 'NONE' | 'PENDING' | 'SKIPPED'
  skipReason: 'missing' | 'opted_out' | null
}

export interface CampaignAudienceRow {
  personId: string | null
  leadId: string | null
  name: string
  email: string | null
  waId: string | null
  emailState: ChannelState
  whatsappState: ChannelState
}

export interface CampaignAudienceCounts {
  total: number
  email: { reachable: number; optedOut: number; missing: number }
  whatsapp: { reachable: number; optedOut: number; missing: number }
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase()
  return value?.includes('@') ? value : null
}

function dedupeKey(candidate: CampaignCandidate, email: string | null) {
  if (candidate.personId) return `p:${candidate.personId}`
  if (candidate.leadId) return `l:${candidate.leadId}`
  if (email) return `e:${email}`
  return null
}

/**
 * Deduplicates by person → lead → e-mail (first candidate wins, so callers
 * pass the most precise sources first) and resolves each channel.
 */
export function buildCampaignAudience(
  candidates: CampaignCandidate[],
  optOuts: CampaignOptOutIndex,
  options: { whatsappEnabled: boolean },
): { rows: CampaignAudienceRow[]; counts: CampaignAudienceCounts } {
  const seen = new Set<string>()
  const seenEmails = new Set<string>()
  const rows: CampaignAudienceRow[] = []

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email)
    const key = dedupeKey(candidate, email)
    if (!key || seen.has(key)) continue
    // The same address under another person/lead is still one inbox.
    if (email && seenEmails.has(email)) continue
    seen.add(key)
    if (email) seenEmails.add(email)

    const waId = toCampaignWaId(candidate.phone)
    const emailOptedOut =
      (email !== null && optOuts.emails.has(email)) ||
      (candidate.personId ? optOuts.personIds.has(candidate.personId) : false)

    rows.push({
      personId: candidate.personId ?? null,
      leadId: candidate.leadId ?? null,
      name: candidate.name.trim() || email || 'Contato',
      email,
      waId,
      emailState: !email
        ? { status: 'NONE', skipReason: 'missing' }
        : emailOptedOut
          ? { status: 'SKIPPED', skipReason: 'opted_out' }
          : { status: 'PENDING', skipReason: null },
      whatsappState: !options.whatsappEnabled
        ? { status: 'NONE', skipReason: null }
        : !waId
          ? { status: 'NONE', skipReason: 'missing' }
          : optOuts.waIds.has(waId)
            ? { status: 'SKIPPED', skipReason: 'opted_out' }
            : { status: 'PENDING', skipReason: null },
    })
  }

  const count = (pick: (row: CampaignAudienceRow) => ChannelState) => ({
    reachable: rows.filter((row) => pick(row).status === 'PENDING').length,
    optedOut: rows.filter((row) => pick(row).skipReason === 'opted_out').length,
    missing: rows.filter((row) => pick(row).skipReason === 'missing').length,
  })

  return {
    rows,
    counts: {
      total: rows.length,
      email: count((row) => row.emailState),
      whatsapp: count((row) => row.whatsappState),
    },
  }
}
