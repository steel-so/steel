import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { searchSettingsOf } from '@/src/lib/sites/search/context'
import {
  INDEXNOW_ENDPOINT,
  indexNowPayload,
} from '@/src/lib/sites/search/indexnow'
import { llmsPages } from '@/src/lib/sites/search/llms'
import type { SiteSnapshot } from '@/src/lib/sites/snapshot'

/** How long a ping may take before it is abandoned (ms). */
export const INDEXNOW_TIMEOUT_MS = 5000

/**
 * IndexNow on publish: when the site turned it on, the indexable URLs of
 * the new version go to `api.indexnow.org` (shared by Bing, Yandex, Seznam
 * and Naver). Best effort — it never fails a publish; the outcome is
 * logged.
 */
export const SiteIndexNowService = {
  /** `sent` is the number of URLs submitted (0 when off or nothing to
   * send); `status` is the engine's HTTP answer, `null` on network error. */
  async ping(
    slug: string,
    snapshot: SiteSnapshot,
    fetcher: typeof fetch = fetch,
  ): Promise<Result<{ sent: number; status: number | null }>> {
    const settings = searchSettingsOf(snapshot.settings)
    const key = settings.indexNow.key
    if (!settings.indexNow.enabled || !key || snapshot.settings.seo.noindex) {
      return ok({ sent: 0, status: null })
    }
    const baseUrl = publicSiteUrl(slug)
    const payload = indexNowPayload({
      baseUrl,
      key,
      urls: llmsPages(snapshot, baseUrl).map((item) => item.url),
    })
    if (!payload) return ok({ sent: 0, status: null })

    try {
      const response = await fetcher(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
      })
      const fields = {
        component: 'SiteIndexNowService',
        slug,
        urls: payload.urlList.length,
        status: response.status,
      }
      if (response.ok) logger.info('site_indexnow.ping', fields)
      else logger.warn('site_indexnow.rejected', fields)
      return ok({ sent: payload.urlList.length, status: response.status })
    } catch (error) {
      logger.warn('site_indexnow.failed', {
        component: 'SiteIndexNowService',
        slug,
        message: error instanceof Error ? error.message : String(error),
      })
      return ok({ sent: payload.urlList.length, status: null })
    }
  },
}
