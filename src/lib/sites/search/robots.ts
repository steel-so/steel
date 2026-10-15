import {
  SITE_CRAWLER_BOTS,
  type SiteCrawlerBot,
} from '@/src/schemas/site-search.schema'

/**
 * Crawler access of a published site: who each bot is, whether it brings
 * visitors (search, assistant) or only feeds model training, and the
 * `robots.txt` built from the site's switches. Pure.
 */

export type CrawlerPurpose = 'search' | 'assistant' | 'training'

export interface CrawlerInfo {
  bot: SiteCrawlerBot
  owner: string
  purpose: CrawlerPurpose
  /** pt-BR: what blocking it changes. */
  description: string
}

export const CRAWLER_INFO: Record<SiteCrawlerBot, CrawlerInfo> = {
  Googlebot: {
    bot: 'Googlebot',
    owner: 'Google',
    purpose: 'search',
    description:
      'Indexa o site na Busca do Google, inclusive nas Visões gerais criadas por IA. Bloquear tira o site do Google.',
  },
  Bingbot: {
    bot: 'Bingbot',
    owner: 'Microsoft',
    purpose: 'search',
    description:
      'Indexa o site no Bing, que também alimenta o Copilot, o DuckDuckGo e parte das buscas do ChatGPT.',
  },
  GPTBot: {
    bot: 'GPTBot',
    owner: 'OpenAI',
    purpose: 'training',
    description:
      'Coleta conteúdo para treinar os modelos da OpenAI. Bloquear não tira o site das respostas do ChatGPT Search.',
  },
  'OAI-SearchBot': {
    bot: 'OAI-SearchBot',
    owner: 'OpenAI',
    purpose: 'search',
    description:
      'Indexa o site para as respostas com fontes do ChatGPT Search. Bloquear tira o site dessas citações.',
  },
  'ChatGPT-User': {
    bot: 'ChatGPT-User',
    owner: 'OpenAI',
    purpose: 'assistant',
    description:
      'Abre uma página quando alguém pede ao ChatGPT para ler um link. Não é usado para treino.',
  },
  PerplexityBot: {
    bot: 'PerplexityBot',
    owner: 'Perplexity',
    purpose: 'search',
    description:
      'Indexa o site para as respostas com fontes do Perplexity. Não é usado para treino.',
  },
  ClaudeBot: {
    bot: 'ClaudeBot',
    owner: 'Anthropic',
    purpose: 'training',
    description: 'Coleta conteúdo público para treinar os modelos Claude.',
  },
  'Google-Extended': {
    bot: 'Google-Extended',
    owner: 'Google',
    purpose: 'training',
    description:
      'Controla o uso do conteúdo para treinar e fundamentar o Gemini. Não muda nada na Busca do Google.',
  },
  CCBot: {
    bot: 'CCBot',
    owner: 'Common Crawl',
    purpose: 'training',
    description:
      'Arquivo público da web usado para treinar muitos modelos de IA.',
  },
}

export const CRAWLER_PURPOSE_LABELS: Record<CrawlerPurpose, string> = {
  search: 'Busca',
  assistant: 'Assistente',
  training: 'Treino de IA',
}

/** Bots switched off (absent means allowed). */
export function blockedCrawlers(
  crawlers: Partial<Record<SiteCrawlerBot, boolean>> | undefined,
): SiteCrawlerBot[] {
  return SITE_CRAWLER_BOTS.filter((bot) => crawlers?.[bot] === false)
}

/** Blocked bots that bring visitors (search and assistants). */
export function blockedAnswerEngines(
  crawlers: Partial<Record<SiteCrawlerBot, boolean>> | undefined,
): SiteCrawlerBot[] {
  return blockedCrawlers(crawlers).filter(
    (bot) => CRAWLER_INFO[bot].purpose !== 'training',
  )
}

/**
 * `robots.txt` of a site: one `Disallow: /` group per blocked bot, then
 * everyone else allowed, the sitemap and the llms.txt hint. A noindex site
 * blocks everything.
 */
export function renderSearchRobotsTxt(options: {
  noindex: boolean
  sitemapUrl: string
  crawlers?: Partial<Record<SiteCrawlerBot, boolean>>
  llmsUrl?: string
}): string {
  if (options.noindex) return 'User-agent: *\nDisallow: /\n'
  const groups = blockedCrawlers(options.crawlers).map(
    (bot) => `User-agent: ${bot}\nDisallow: /\n`,
  )
  const lines = [
    ...groups,
    'User-agent: *\nAllow: /\n',
    `Sitemap: ${options.sitemapUrl}\n`,
  ]
  if (options.llmsUrl)
    lines.push(`# LLM-friendly summary: ${options.llmsUrl}\n`)
  return lines.join('\n')
}
