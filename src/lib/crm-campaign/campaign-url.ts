/**
 * Public URLs of a campaign destination and its UTM parameters. Pure and
 * client-safe: the wizard shows the same links the e-mails carry.
 */

export type CampaignUtmSource = 'email' | 'whatsapp'

/** Query parameter carrying the signed per-recipient link token. */
export const CAMPAIGN_REF_PARAM = 'stc'

/** Variables of the visual e-mail builder (`crm-email-builder/variables.ts`). */
export const CAMPAIGN_LINK_MERGE_TAG = '{{campaign_link}}'
export const CAMPAIGN_FIRST_NAME_MERGE_TAG = '{{primeiro_nome}}'

export interface CampaignDestinationRef {
  type: 'LANDING_PAGE' | 'FORM'
  /** Landing page share token or form public token. */
  token: string
}

/** A site page already resolved to its public URL (subdomain or `/s/`). */
export interface CampaignSitePageRef {
  type: 'SITE_PAGE'
  url: string
}

export function buildDestinationUrl(
  baseUrl: string,
  destination: CampaignDestinationRef,
): string {
  const base = baseUrl.replace(/\/$/, '')
  const prefix = destination.type === 'LANDING_PAGE' ? 'l' : 'f'
  return `${base}/${prefix}/${destination.token}`
}

/** Public URL of any campaign destination. */
export function campaignDestinationUrl(
  baseUrl: string,
  destination: CampaignDestinationRef | CampaignSitePageRef,
): string {
  return destination.type === 'SITE_PAGE'
    ? destination.url
    : buildDestinationUrl(baseUrl, destination)
}

export function withCampaignParams(
  url: string,
  params: {
    source: CampaignUtmSource
    medium: string
    campaign: string
    ref?: string
  },
): string {
  const target = new URL(url)
  target.searchParams.set('utm_source', params.source)
  target.searchParams.set('utm_medium', params.medium)
  target.searchParams.set('utm_campaign', params.campaign)
  if (params.ref) target.searchParams.set(CAMPAIGN_REF_PARAM, params.ref)
  return target.toString()
}

/** `utm_campaign` slug: lower-case ASCII, digits and dashes. */
export function slugifyCampaignName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || 'campanha'
}

export interface CampaignRefParams {
  ref?: string
  utmCampaign?: string
  utmSource?: string
}

/** Reads the campaign parameters of a public page URL (`location.search`). */
export function readCampaignRefParams(search: string): CampaignRefParams {
  const params = new URLSearchParams(search)
  const pick = (key: string) => {
    const value = params.get(key)?.trim()
    return value ? value.slice(0, 200) : undefined
  }
  return {
    ref: pick(CAMPAIGN_REF_PARAM),
    utmCampaign: pick('utm_campaign'),
    utmSource: pick('utm_source'),
  }
}

/** `true` when the page was reached through some campaign parameter. */
export function hasCampaignRef(ref: CampaignRefParams): boolean {
  return Boolean(ref.ref || ref.utmCampaign)
}
