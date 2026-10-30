import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { MetaApiError, type MetaCredentials, metaRequest } from './meta-client'

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

/** Meta keeps template analytics for 90 days and needs `end` in the past. */
const MAX_PERIOD_MS = 90 * 86_400_000
/** A slow Graph API must not hold the metrics dialog hostage. */
const REQUEST_TIMEOUT_MS = 10_000

/** Meta has no template with this name and language (renamed or deleted). */
export class MarketingLiteTemplateNotFoundError extends Error {
  constructor() {
    super('Template not found at Meta')
    this.name = 'MarketingLiteTemplateNotFoundError'
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80_004])

/** pt-BR reason shown instead of the metrics when the Meta call fails. */
export function describeMarketingLiteError(error: unknown): string {
  if (error instanceof MarketingLiteTemplateNotFoundError) {
    return 'A Meta não encontrou o template desta transmissão (ele pode ter sido renomeado ou excluído).'
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'A Meta demorou demais para responder. Tente de novo em instantes.'
    }
  }
  if (error instanceof MetaApiError) {
    if (error.code === 190 || error.status === 401) {
      return 'O token de acesso da conexão expirou ou foi revogado. Reconecte o número.'
    }
    if (
      error.code === 10 ||
      (error.code !== undefined && error.code >= 200 && error.code <= 299) ||
      error.status === 403
    ) {
      return 'A conexão não tem permissão para ler as métricas de templates na Meta.'
    }
    if (
      error.status === 429 ||
      (error.code !== undefined && RATE_LIMIT_CODES.has(error.code))
    ) {
      return 'A Meta limitou as consultas por enquanto. Tente de novo em alguns minutos.'
    }
    if (error.status >= 500) {
      return 'A Meta está instável agora. Tente de novo em alguns minutos.'
    }
  }
  return 'Não foi possível consultar as métricas na Meta agora.'
}

const EMPTY: MarketingLiteAnalytics = {
  sent: 0,
  delivered: 0,
  read: 0,
  clicked: 0,
}

/** A metric Meta returned, or 0 when it is missing or not a number. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
    { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )
  const candidates = Array.isArray(lookup?.data) ? lookup.data : []
  const id = candidates.find(
    (candidate) => candidate?.language === template.language,
  )?.id
  if (!id) throw new MarketingLiteTemplateNotFoundError()

  // Meta rejects a window older than 90 days or ending in the future.
  const end = Math.min(period.to.getTime(), Date.now())
  const start = Math.max(
    Math.min(period.from.getTime(), end - 86_400_000),
    end - MAX_PERIOD_MS,
  )
  const unix = (ms: number) => Math.floor(ms / 1000)
  const query = new URLSearchParams({
    start: String(unix(start)),
    end: String(unix(end)),
    granularity: 'DAILY',
    metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED']),
    template_ids: JSON.stringify([id]),
  })
  const analytics = await metaRequest<AnalyticsResponse>(
    credentials,
    `/${credentials.wabaId}/template_analytics?${query.toString()}`,
    { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )

  const totals = { ...EMPTY }
  const series = Array.isArray(analytics?.data) ? analytics.data : []
  for (const template of series) {
    const points = Array.isArray(template?.data_points)
      ? template.data_points
      : []
    for (const point of points) {
      totals.sent += count(point?.sent)
      totals.delivered += count(point?.delivered)
      totals.read += count(point?.read)
      const clicks = Array.isArray(point?.clicked) ? point.clicked : []
      totals.clicked += clicks.reduce(
        (sum, click) => sum + count(click?.count),
        0,
      )
    }
  }
  return totals
}
