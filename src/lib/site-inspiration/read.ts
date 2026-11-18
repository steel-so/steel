import {
  UNTRUSTED_CONTENT_POLICY,
  wrapUntrusted,
} from '@/src/lib/ai/guardrails/injection'
import {
  fetchHtml,
  SAFE_FETCH_MESSAGES,
  type SafeFetchResult,
  stripUrlForDisplay,
} from '@/src/lib/safe-fetch/fetch-html'
import {
  extractInspirationBrief,
  formatInspirationBrief,
  type InspirationBrief,
} from './brief'

/** Most characters one reference adds to the prompt. */
export const MAX_BRIEF_CHARS = 3_000

export interface InspirationLinkResult {
  /** Origin + path, never the query string. */
  url: string
  status: 'read' | 'failed'
  /** pt-BR reason when `status` is `failed`. */
  message: string | null
  brief: InspirationBrief | null
}

/** Reads one link into a brief; every failure becomes a `failed` result. */
export async function readInspirationLink(
  rawUrl: string,
  fetcher: (url: string) => Promise<SafeFetchResult> = fetchHtml,
): Promise<InspirationLinkResult> {
  const url = stripUrlForDisplay(rawUrl) || 'link inválido'
  try {
    const fetched = await fetcher(rawUrl)
    if (!fetched.ok) {
      return {
        url,
        status: 'failed',
        message: SAFE_FETCH_MESSAGES[fetched.reason],
        brief: null,
      }
    }
    const brief = extractInspirationBrief(fetched.html, {
      truncated: fetched.truncated,
    })
    // A page that renders in the browser (empty shell) has nothing to read.
    if (brief.headings.length === 0 && brief.sections.length === 0) {
      return {
        url,
        status: 'failed',
        message:
          'A página quase não tem conteúdo legível (talvez só carregue com JavaScript).',
        brief: null,
      }
    }
    return { url, status: 'read', message: null, brief }
  } catch {
    return {
      url,
      status: 'failed',
      message: SAFE_FETCH_MESSAGES.network,
      brief: null,
    }
  }
}

/**
 * Prompt block with the briefs that were read: quoted as untrusted data and
 * preceded by the inspiration-not-copy rule. Empty when nothing was read.
 */
export function buildInspirationBlock(
  results: InspirationLinkResult[],
  focus: string,
): string[] {
  const read = results.filter(
    (result): result is InspirationLinkResult & { brief: InspirationBrief } =>
      result.status === 'read' && result.brief !== null,
  )
  if (read.length === 0) return []
  const body = read
    .map((result) =>
      formatInspirationBrief(result.brief, new URL(result.url).hostname)
        .join('\n')
        .slice(0, MAX_BRIEF_CHARS),
    )
    .join('\n\n---\n\n')
  return [
    'Referências de inspiração (resumos de sites que o cliente gosta):',
    ...(focus ? [`O que aproveitar, segundo o cliente: ${focus}`] : []),
    wrapUntrusted(body, 'web_inspiration'),
  ]
}

/** System-prompt rules that go with the block above. */
export const INSPIRATION_RULES = [
  'Os resumos de referência são só inspiração: aproveite a estrutura, a hierarquia, a ordem das seções, o espaçamento, o estilo visual e o tom.',
  'Nunca copie textos, títulos, slogans, nomes de marca, logos, imagens, preços ou dados dos sites de referência. Escreva textos ORIGINAIS para o negócio descrito no briefing, com a marca dele.',
  UNTRUSTED_CONTENT_POLICY,
]
