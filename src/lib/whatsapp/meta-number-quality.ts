import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import type { WhatsAppTemplateQualityDTO } from '@/types/whatsapp-template'

const META_GRAPH_VERSION = 'v26.0'
const TIMEOUT_MS = 4_000
/** A rating is reused for 30 min; a failed lookup is retried after 2 min. */
const FRESH_MS = 30 * 60_000
const RETRY_MS = 2 * 60_000

const RATINGS: Record<string, WhatsAppTemplateQualityDTO> = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
}

type Entry = { quality: WhatsAppTemplateQualityDTO; expiresAt: number }
const cache = new Map<string, Entry>()

/** Tests only: forgets the cached ratings. */
export function clearMetaNumberQualityCache(): void {
  cache.clear()
}

/**
 * Meta's quality rating of a business phone number (`quality_rating`:
 * GREEN, YELLOW or RED; anything else reads as UNKNOWN). Throws on a
 * network or Graph API failure.
 */
export async function fetchMetaNumberQuality(input: {
  phoneNumberId: string
  accessToken: string
}): Promise<WhatsAppTemplateQualityDTO> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${input.phoneNumberId}?fields=quality_rating`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await response.json().catch(() => null)) as {
    quality_rating?: string
    error?: { message?: string }
  } | null
  if (!response.ok) {
    throw new Error(
      body?.error?.message ??
        `Failed to read the number quality (${response.status})`,
    )
  }
  return RATINGS[body?.quality_rating?.toUpperCase() ?? ''] ?? 'UNKNOWN'
}

/**
 * Quality rating of the number behind a connection, cached per connection.
 * Never fails: a connection that is not Meta, or a lookup that breaks,
 * reads as UNKNOWN (the template list must not depend on Meta being up).
 */
export async function metaNumberQualityOf(
  connection: Pick<
    WhatsAppConnection,
    'id' | 'provider' | 'metaPhoneNumberId' | 'encryptedMetaAccessToken'
  >,
  now: number = Date.now(),
): Promise<WhatsAppTemplateQualityDTO> {
  if (
    connection.provider !== 'META' ||
    !connection.metaPhoneNumberId ||
    !connection.encryptedMetaAccessToken
  ) {
    return 'UNKNOWN'
  }
  const hit = cache.get(connection.id)
  if (hit && hit.expiresAt > now) return hit.quality
  try {
    const quality = await fetchMetaNumberQuality({
      phoneNumberId: connection.metaPhoneNumberId,
      accessToken: await decryptConnectionSecret(
        connection.encryptedMetaAccessToken,
      ),
    })
    cache.set(connection.id, { quality, expiresAt: now + FRESH_MS })
    return quality
  } catch (error) {
    logger.warn('whatsapp.number_quality.lookup_failed', {
      connectionId: connection.id,
      reason: error instanceof Error ? error.message : String(error),
    })
    // Keeps the last known rating while Meta is unreachable.
    const quality = hit?.quality ?? 'UNKNOWN'
    cache.set(connection.id, { quality, expiresAt: now + RETRY_MS })
    return quality
  }
}
