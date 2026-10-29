import { toCampaignWaId } from '@/src/lib/crm-campaign/phone'
import {
  type CampaignWhatsAppProvider,
  validateCampaignWhatsApp,
} from '@/src/lib/crm-campaign/whatsapp-rules'
import type { CrmCampaignWhatsAppVariables } from '@/src/schemas/crm-campaign.schema'
import {
  type CrmNewsletterWhatsAppReachDTO,
  type CrmNewsletterWhatsAppVariables,
  NEWSLETTER_WA_TEXT_TOKENS,
} from '@/src/schemas/crm-newsletter-engage.schema'

/**
 * Pure rules of the WhatsApp version of a newsletter issue (nl2-engage),
 * on top of the multichannel campaign rules (ADR 0025): who gets it (one
 * row per number of a subscriber's CRM person), and how the issue content
 * (`summary`, `subject`) maps onto the campaign variable sources so the
 * campaign renderers (`whatsapp-rules.ts`) do the rest.
 */

export type NewsletterWhatsAppCandidate = {
  subscriberId: string
  personId: string
  name: string
  phones: string[]
}

export type NewsletterWhatsAppRow = {
  subscriberId: string
  personId: string
  name: string
  waId: string
  status: 'PENDING' | 'SKIPPED'
  skipReason: 'OPTED_OUT' | null
}

/** First phone of the person that is a valid WhatsApp number. */
export function candidateWaId(
  candidate: Pick<NewsletterWhatsAppCandidate, 'phones'>,
): string | null {
  for (const phone of candidate.phones) {
    const waId = toCampaignWaId(phone)
    if (waId) return waId
  }
  return null
}

/**
 * One row per number (the first subscriber wins when two share a phone);
 * opted-out numbers are kept as SKIPPED for the report.
 */
export function buildNewsletterWhatsAppAudience(
  candidates: NewsletterWhatsAppCandidate[],
  optedOut: ReadonlySet<string>,
): { rows: NewsletterWhatsAppRow[]; reach: CrmNewsletterWhatsAppReachDTO } {
  const rows: NewsletterWhatsAppRow[] = []
  const seen = new Set<string>()
  let missingPhone = 0
  for (const candidate of candidates) {
    const waId = candidateWaId(candidate)
    if (!waId) {
      missingPhone += 1
      continue
    }
    if (seen.has(waId)) continue
    seen.add(waId)
    const opted = optedOut.has(waId)
    rows.push({
      subscriberId: candidate.subscriberId,
      personId: candidate.personId,
      name: candidate.name.trim() || 'Contato',
      waId,
      status: opted ? 'SKIPPED' : 'PENDING',
      skipReason: opted ? 'OPTED_OUT' : null,
    })
  }
  return {
    rows,
    reach: {
      linked: candidates.length,
      reachable: rows.filter((row) => row.status === 'PENDING').length,
      missingPhone,
      optedOut: rows.filter((row) => row.status === 'SKIPPED').length,
    },
  }
}

export type IssueWhatsAppContent = {
  /** Issue excerpt (or preheader) — `{resumo}` / `summary`. */
  summary: string
  /** Issue subject — `{assunto}` / `subject`. */
  subject: string
}

/** Newsletter sources → campaign sources (issue fields become static). */
export function toCampaignVariables(
  variables: CrmNewsletterWhatsAppVariables | null,
  content: IssueWhatsAppContent,
): CrmCampaignWhatsAppVariables | null {
  if (!variables) return null
  const map = (group: CrmNewsletterWhatsAppVariables['body']) =>
    Object.fromEntries(
      Object.entries(group ?? {}).map(([key, value]) => [
        key,
        value.source === 'summary'
          ? { source: 'static' as const, value: content.summary || ' ' }
          : value.source === 'subject'
            ? { source: 'static' as const, value: content.subject || ' ' }
            : { source: value.source, value: value.value },
      ]),
    )
  return {
    header: map(variables.header),
    body: map(variables.body),
    buttons: map(variables.buttons),
  }
}

/** `{resumo}` and `{assunto}` of the Z-API text; `renderZapiText` does the
 * contact tokens and `{link}` afterwards. */
export function applyIssueTextTokens(
  text: string,
  content: IssueWhatsAppContent,
): string {
  return text
    .replaceAll(NEWSLETTER_WA_TEXT_TOKENS.summary, content.summary)
    .replaceAll(NEWSLETTER_WA_TEXT_TOKENS.subject, content.subject)
}

/** Summary sent on WhatsApp: the excerpt, cut on a word near 280 chars. */
export function whatsappSummary(excerpt: string | null | undefined): string {
  const text = (excerpt ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= 280) return text
  const cut = text.slice(0, 280)
  const space = cut.lastIndexOf(' ')
  return `${(space > 200 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Path of the web version after `/n/` — the `link_code` of URL buttons. */
export function issueLinkCode(webUrl: string): string {
  const at = webUrl.indexOf('/n/')
  return at === -1 ? webUrl : webUrl.slice(at + 3)
}

/** pt-BR problems of the content (reuses the campaign validation). */
export function newsletterWhatsAppProblems(input: {
  provider: CampaignWhatsAppProvider
  template: {
    status: string
    components: unknown
    quality?: string
    statusReason?: string | null
  } | null
  variables: CrmNewsletterWhatsAppVariables | null
  text: string | null
}): string[] {
  return validateCampaignWhatsApp({
    provider: input.provider,
    template: input.template,
    variables: toCampaignVariables(input.variables, {
      summary: 'resumo',
      subject: 'assunto',
    }),
    text: input.text,
    mediaUrl: null,
  })
}
