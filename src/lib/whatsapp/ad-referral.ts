/**
 * The `referral` block Meta sends with the first message of a contact that
 * clicked a Click-to-WhatsApp ad (or a post). Pure helpers: parsing the
 * webhook payload and naming the CRM lead source.
 */

export interface InboundAdReferral {
  /** `ad` or `post`. */
  sourceType: string
  /** Meta ad id (or post id): the grouping key of the report. */
  sourceId: string
  sourceUrl?: string
  headline?: string
  body?: string
  mediaType?: string
  mediaUrl?: string
  ctwaClid?: string
}

const LIMITS = {
  sourceType: 20,
  sourceId: 100,
  sourceUrl: 1000,
  headline: 300,
  body: 1000,
  mediaType: 20,
  mediaUrl: 1000,
  ctwaClid: 500,
} as const

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

/**
 * Reads Meta's `message.referral`. Returns null when the block has nothing
 * that identifies the ad (no id, URL or click id), so an empty object never
 * becomes a "mystery ad".
 */
export function parseMetaReferral(raw: unknown): InboundAdReferral | null {
  if (!raw || typeof raw !== 'object') return null
  const block = raw as Record<string, unknown>

  const sourceUrl = text(block.source_url, LIMITS.sourceUrl)
  const ctwaClid = text(block.ctwa_clid, LIMITS.ctwaClid)
  // Without an id the URL still names the ad uniquely enough to group on.
  const sourceId = text(block.source_id, LIMITS.sourceId) ?? sourceUrl
  if (!sourceId) return null

  const mediaType = text(block.media_type, LIMITS.mediaType)?.toLowerCase()
  const mediaUrl =
    text(block.image_url, LIMITS.mediaUrl) ??
    text(block.thumbnail_url, LIMITS.mediaUrl) ??
    text(block.video_url, LIMITS.mediaUrl)

  return {
    sourceType:
      text(block.source_type, LIMITS.sourceType)?.toLowerCase() ?? 'ad',
    sourceId: sourceId.slice(0, LIMITS.sourceId),
    sourceUrl,
    headline: text(block.headline, LIMITS.headline),
    body: text(block.body, LIMITS.body),
    mediaType,
    mediaUrl,
    ctwaClid,
  }
}

/** `CrmLead.source` is capped at 100 characters. */
const LEAD_SOURCE_MAX = 100

/** "Anúncio Click-to-WhatsApp · Promoção de verão", trimmed to fit. */
export function adLeadSource(
  base: string,
  headline: string | undefined | null,
): string {
  const head = base.trim().slice(0, LEAD_SOURCE_MAX)
  const name = headline?.trim()
  if (!name) return head
  const joined = `${head} · ${name}`
  return joined.length <= LEAD_SOURCE_MAX
    ? joined
    : `${joined.slice(0, LEAD_SOURCE_MAX - 1)}…`
}

/** Phone digits a CRM lead can carry; BSUID-only contacts have none. */
export function leadPhoneFromWaId(waId: string): string | null {
  return /^\d{8,15}$/.test(waId) ? waId : null
}
