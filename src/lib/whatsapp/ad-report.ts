import type {
  WhatsAppAdMetricsDTO,
  WhatsAppAdReportDTO,
  WhatsAppAdReportRowDTO,
} from '@/types/whatsapp-ad'
import { roundCents } from './cost'

export interface AdReportReferral {
  sourceId: string
  sourceType: string
  sourceUrl: string | null
  headline: string | null
  contactId: string
  conversationId: string
  leadId: string | null
  receivedAt: Date
}

export interface AdReportLead {
  id: string
  closeResult: string | null
  closedAmount: number | null
}

export interface AdReportSpend {
  sourceId: string
  label: string | null
  /** `YYYY-MM-DD`, inclusive. */
  periodStart: string
  periodEnd: string
  amount: number
}

const DAY_MS = 86_400_000

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
}

/**
 * Part of a spend row that belongs to `[from, to]` (inclusive days): the
 * amount is spread evenly over the days of its own period.
 */
export function proratedAdSpend(
  spend: Pick<AdReportSpend, 'periodStart' | 'periodEnd' | 'amount'>,
  from: string,
  to: string,
): number {
  const start = dayNumber(spend.periodStart)
  const end = dayNumber(spend.periodEnd)
  const overlap =
    Math.min(end, dayNumber(to)) - Math.max(start, dayNumber(from)) + 1
  if (overlap <= 0 || end < start) return 0
  return (spend.amount * overlap) / (end - start + 1)
}

/** Cost per unit; null without spend (no data, not "free") or volume. */
function ratio(total: number, volume: number): number | null {
  return total > 0 && volume > 0 ? roundCents(total / volume) : null
}

function finish(
  raw: Omit<
    WhatsAppAdMetricsDTO,
    'costPerConversation' | 'costPerLead' | 'roi'
  >,
): WhatsAppAdMetricsDTO {
  const revenue = roundCents(raw.revenue)
  const spend = roundCents(raw.spend)
  return {
    ...raw,
    revenue,
    spend,
    costPerConversation: ratio(spend, raw.conversations),
    costPerLead: ratio(spend, raw.leads),
    roi: spend > 0 ? Math.round(((revenue - spend) / spend) * 100) / 100 : null,
  }
}

interface Bucket {
  sourceId: string
  sourceType: string
  name: string | null
  sourceUrl: string | null
  latest: number
  clicks: number
  conversations: Set<string>
  contacts: Set<string>
  leads: Set<string>
  spend: number
  label: string | null
}

function bucketFor(
  buckets: Map<string, Bucket>,
  sourceId: string,
  sourceType = 'ad',
): Bucket {
  let bucket = buckets.get(sourceId)
  if (!bucket) {
    bucket = {
      sourceId,
      sourceType,
      name: null,
      sourceUrl: null,
      latest: 0,
      clicks: 0,
      conversations: new Set(),
      contacts: new Set(),
      leads: new Set(),
      spend: 0,
      label: null,
    }
    buckets.set(sourceId, bucket)
  }
  return bucket
}

/**
 * Groups referrals by ad and joins the CRM outcome (leads, won deals) and the
 * typed spend. An ad with spend but no click in the range still has a row.
 * Revenue is the `closedAmount` of the won leads attributed to the ad.
 */
export function buildAdReport(input: {
  from: string
  to: string
  referrals: AdReportReferral[]
  leads: AdReportLead[]
  spends: AdReportSpend[]
}): WhatsAppAdReportDTO {
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const buckets = new Map<string, Bucket>()

  for (const referral of input.referrals) {
    const bucket = bucketFor(buckets, referral.sourceId, referral.sourceType)
    bucket.clicks += 1
    bucket.conversations.add(referral.conversationId)
    bucket.contacts.add(referral.contactId)
    if (referral.leadId && leadById.has(referral.leadId)) {
      bucket.leads.add(referral.leadId)
    }
    const at = referral.receivedAt.getTime()
    if (at >= bucket.latest) {
      bucket.latest = at
      bucket.sourceType = referral.sourceType
      bucket.sourceUrl = referral.sourceUrl ?? bucket.sourceUrl
      bucket.name = referral.headline ?? bucket.name
    }
  }

  for (const spend of input.spends) {
    const part = proratedAdSpend(spend, input.from, input.to)
    if (part <= 0) continue
    const bucket = bucketFor(buckets, spend.sourceId)
    bucket.spend += part
    bucket.label = spend.label ?? bucket.label
  }

  const rows: WhatsAppAdReportRowDTO[] = []
  for (const bucket of buckets.values()) {
    let won = 0
    let revenue = 0
    for (const leadId of bucket.leads) {
      const lead = leadById.get(leadId)
      if (lead?.closeResult === 'WON') {
        won += 1
        revenue += lead.closedAmount ?? 0
      }
    }
    rows.push({
      sourceId: bucket.sourceId,
      sourceType: bucket.sourceType,
      name: bucket.name ?? bucket.label,
      sourceUrl: bucket.sourceUrl,
      ...finish({
        clicks: bucket.clicks,
        conversations: bucket.conversations.size,
        contacts: bucket.contacts.size,
        leads: bucket.leads.size,
        leadsWon: won,
        revenue,
        spend: bucket.spend,
      }),
    })
  }
  rows.sort(
    (a, b) =>
      b.conversations - a.conversations ||
      b.spend - a.spend ||
      a.sourceId.localeCompare(b.sourceId),
  )

  const conversations = new Set<string>()
  const contacts = new Set<string>()
  const leads = new Set<string>()
  for (const referral of input.referrals) {
    conversations.add(referral.conversationId)
    contacts.add(referral.contactId)
    if (referral.leadId && leadById.has(referral.leadId)) {
      leads.add(referral.leadId)
    }
  }
  const totals = finish({
    clicks: input.referrals.length,
    conversations: conversations.size,
    contacts: contacts.size,
    leads: leads.size,
    leadsWon: rows.reduce((sum, row) => sum + row.leadsWon, 0),
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    spend: rows.reduce((sum, row) => sum + row.spend, 0),
  })

  return { from: input.from, to: input.to, totals, rows }
}
