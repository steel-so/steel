import { WEB_SEARCH_API_KEY } from '@/lib/env/server'
import {
  crmProspectSearchNotConfigured,
  crmProspectWebFailed,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Web search behind an interface (T5). The default provider is the Brave
 * Search API (`WEB_SEARCH_API_KEY`); another one only has to implement
 * `WebSearchProvider`. Without a key the search tool answers
 * `CRM_PROSPECT_SEARCH_NOT_CONFIGURED` and the agent can still read pages
 * it already knows.
 */

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
}

export interface WebSearchProvider {
  readonly source: string
  search(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Result<WebSearchHit[]>>
}

export const WEB_SEARCH_TIMEOUT_MS = 10_000
export const WEB_SEARCH_MAX_RESULTS = 8

interface BraveResponse {
  web?: {
    results?: { title?: unknown; url?: unknown; description?: unknown }[]
  }
}

const stripTags = (value: string) => value.replace(/<[^>]+>/g, '').trim()

export function createBraveSearchProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): WebSearchProvider {
  return {
    source: 'brave',
    async search(query, limit, signal) {
      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(Math.max(limit, 1), WEB_SEARCH_MAX_RESULTS)),
        country: 'BR',
        search_lang: 'pt',
        safesearch: 'moderate',
      })
      try {
        const response = await fetchImpl(
          `https://api.search.brave.com/res/v1/web/search?${params}`,
          {
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': apiKey,
            },
            signal: signal ?? AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
          },
        )
        if (!response.ok) {
          return err(
            crmProspectWebFailed(
              `O serviço de busca respondeu ${response.status}`,
            ),
          )
        }
        const data = (await response.json()) as BraveResponse
        const hits: WebSearchHit[] = []
        for (const item of data.web?.results ?? []) {
          if (typeof item.url !== 'string' || !item.url.startsWith('https://')) {
            continue
          }
          hits.push({
            title: stripTags(String(item.title ?? '')).slice(0, 200),
            url: item.url,
            snippet: stripTags(String(item.description ?? '')).slice(0, 400),
          })
        }
        return ok(hits)
      } catch {
        return err(crmProspectWebFailed('Não foi possível buscar na web'))
      }
    },
  }
}

/** The configured provider, or `null` when the environment has no key. */
export function getWebSearchProvider(): WebSearchProvider | null {
  return WEB_SEARCH_API_KEY
    ? createBraveSearchProvider(WEB_SEARCH_API_KEY)
    : null
}

export function requireWebSearchProvider(): Result<WebSearchProvider> {
  const provider = getWebSearchProvider()
  return provider ? ok(provider) : err(crmProspectSearchNotConfigured())
}
