import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { type MetaCredentials, metaRequest } from './meta-client'

/** Template totals Meta reports for a period (Marketing Messages Lite). */
export interface MarketingLiteAnalytics {
  sent: number
  delivered: number
  read: number
  clicked: number
}

interface TemplateLookup {
  data?: { id?: string; language?: string }[]
}

interface AnalyticsResponse {
  data?: {
    data_points?: {
      sent?: number
      delivered?: number
      read?: number
      clicked?: { count?: number }[]
    }[]
  }[]
}

const EMPTY: MarketingLiteAnalytics = {
  sent: 0,
  delivered: 0,
  read: 0,
  clicked: 0,
}

/** Meta credentials of a connection, or null when it isn't a Meta one. */
export async function metaCredentialsOf(
  connection: WhatsAppConnection,
): Promise<MetaCredentials | null> {
  if (
    connection.provider !== 'META' ||
    !connection.metaPhoneNumberId ||
    !connection.metaWabaId ||
    !connection.encryptedMetaAccessToken
  ) {
    return null
  }
  return {
    phoneNumberId: connection.metaPhoneNumberId,
    wabaId: connection.metaWabaId,
    accessToken: await decryptConnectionSecret(
      connection.encryptedMetaAccessToken,
    ),
  }
}

/**
 * Sent / delivered / read / clicked totals Meta keeps for a template between
 * two instants (`template_analytics`). We don't store Meta's template id, so
 * it is looked up by name and language first.
 */
export async function fetchMarketingLiteAnalytics(
  credentials: MetaCredentials,
  template: { name: string; language: string },
  period: { from: Date; to: Date },
): Promise<MarketingLiteAnalytics> {
  const lookup = await metaRequest<TemplateLookup>(
    credentials,
    `/${credentials.wabaId}/message_templates?fields=id,language&limit=50&name=${encodeURIComponent(template.name)}`,
    { method: 'GET' },
  )
  const id = lookup.data?.find(
    (candidate) => candidate.language === template.language,
  )?.id
  if (!id) return { ...EMPTY }

  const unix = (date: Date) => Math.floor(date.getTime() / 1000)
  const query = new URLSearchParams({
    start: String(unix(period.from)),
    end: String(unix(period.to)),
    granularity: 'DAILY',
    metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED']),
    template_ids: JSON.stringify([id]),
  })
  const analytics = await metaRequest<AnalyticsResponse>(
    credentials,
    `/${credentials.wabaId}/template_analytics?${query.toString()}`,
    { method: 'GET' },
  )

  const totals = { ...EMPTY }
  for (const template of analytics.data ?? []) {
    for (const point of template.data_points ?? []) {
      totals.sent += point.sent ?? 0
      totals.delivered += point.delivered ?? 0
      totals.read += point.read ?? 0
      totals.clicked += (point.clicked ?? []).reduce(
        (sum, click) => sum + (click.count ?? 0),
        0,
      )
    }
  }
  return totals
}
