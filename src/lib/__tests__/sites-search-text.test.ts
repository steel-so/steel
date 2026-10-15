import { describe, expect, it } from 'vitest'
import {
  generateIndexNowKey,
  INDEXNOW_MAX_URLS,
  indexNowPayload,
} from '@/src/lib/sites/search/indexnow'
import {
  blockedAnswerEngines,
  blockedCrawlers,
  CRAWLER_INFO,
  renderSearchRobotsTxt,
} from '@/src/lib/sites/search/robots'
import { serpPreview, serpUrl, textPixels } from '@/src/lib/sites/search/serp'
import {
  containsAny,
  countTerm,
  countWords,
  isFactual,
  isQuestion,
  normalizeText,
  sentencesOf,
  slugForm,
  truncateWords,
  wordsOf,
} from '@/src/lib/sites/search/text'
import { SITE_CRAWLER_BOTS } from '@/src/schemas/site-search.schema'

describe('search text helpers', () => {
  it('normalizes accents, case and spaces', () => {
    expect(normalizeText('  Implante   DENTÁRIO ')).toBe('implante dentario')
  })

  it('counts words, keeping hyphenated ones together', () => {
    expect(wordsOf('Bem-vindo à clínica, 24h!')).toEqual([
      'Bem-vindo',
      'à',
      'clínica',
      '24h',
    ])
    expect(countWords('')).toBe(0)
  })

  it('splits sentences', () => {
    expect(sentencesOf('Uma frase. Outra? Sim!  ')).toEqual([
      'Uma frase.',
      'Outra?',
      'Sim!',
    ])
  })

  it('detects questions by mark or opener', () => {
    expect(isQuestion('Quanto custa um implante?')).toBe(true)
    expect(isQuestion('Como funciona o tratamento')).toBe(true)
    expect(isQuestion('Por que, afinal')).toBe(true)
    expect(isQuestion('quanto')).toBe(true)
    expect(isQuestion('Nossos serviços')).toBe(false)
    expect(isQuestion('   ')).toBe(false)
  })

  it('counts whole-word terms, accent-insensitive', () => {
    expect(
      countTerm(
        'Implante dentário: o implante dentario dura',
        'implante dentário',
      ),
    ).toBe(2)
    expect(countTerm('implantes', 'implante')).toBe(0)
    expect(countTerm('qualquer texto', '  ')).toBe(0)
    expect(countTerm('preço (R$ 100)', 'r$ 100')).toBe(1)
    expect(
      containsAny('Clínica odontológica', ['dentista', 'odontológica']),
    ).toBe(true)
    expect(containsAny('Clínica', [])).toBe(false)
  })

  it('builds slug forms', () => {
    expect(slugForm('Implante dentário!')).toBe('implante-dentario')
  })

  it('truncates on word boundaries', () => {
    expect(truncateWords('curto', 20)).toBe('curto')
    expect(truncateWords('uma frase bem longa para cortar aqui', 20)).toBe(
      'uma frase bem longa…',
    )
    expect(truncateWords('supercalifragilistico', 8)).toBe('superca…')
  })

  it('flags factual sentences', () => {
    expect(isFactual('Atendemos 300 pacientes por mês.')).toBe(true)
    expect(isFactual('Atendemos muitos pacientes.')).toBe(false)
  })
})

describe('SERP preview', () => {
  it('keeps short titles and descriptions whole', () => {
    const preview = serpPreview(
      'Implante dentário',
      'Descrição curta.',
      'desktop',
    )
    expect(preview).toEqual({
      title: 'Implante dentário',
      description: 'Descrição curta.',
      titleCut: false,
      descriptionCut: false,
    })
  })

  it('cuts long ones like the result page', () => {
    const title =
      'Implante dentário em São Paulo com especialistas e preço justo para toda a família'
    const description = 'a '.repeat(100).trim()
    const desktop = serpPreview(title, description, 'desktop')
    expect(desktop.titleCut).toBe(true)
    expect(desktop.title.endsWith('…')).toBe(true)
    expect(textPixels(desktop.title)).toBeLessThanOrEqual(580)
    expect(desktop.descriptionCut).toBe(true)
    expect(desktop.description.length).toBeLessThanOrEqual(158)
    expect(serpPreview(title, description, 'mobile').titleCut).toBe(false)
  })

  it('cuts a single long word too', () => {
    expect(
      serpPreview('W'.repeat(80), '', 'desktop').title.endsWith(' …'),
    ).toBe(true)
  })

  it('weights narrow and wide characters', () => {
    expect(textPixels('il')).toBeLessThan(textPixels('mw'))
    expect(textPixels('A')).toBeGreaterThan(textPixels('a'))
    expect(textPixels('t ')).toBe(14)
  })

  it('formats the URL as breadcrumbs', () => {
    expect(serpUrl('https://clinica.site.app/servicos/implante')).toBe(
      'clinica.site.app › servicos › implante',
    )
    expect(serpUrl('não é url')).toBe('não é url')
  })
})

describe('IndexNow', () => {
  it('generates a 32-char hex key', () => {
    expect(generateIndexNowKey()).toMatch(/^[a-f0-9]{32}$/)
    expect(generateIndexNowKey(() => new Uint8Array([0, 15, 255]))).toBe(
      '000fff',
    )
  })

  it('builds the payload with unique URLs', () => {
    expect(
      indexNowPayload({
        baseUrl: 'https://clinica.sites.app',
        key: 'abc12345',
        urls: ['https://clinica.sites.app', 'https://clinica.sites.app'],
      }),
    ).toEqual({
      host: 'clinica.sites.app',
      key: 'abc12345',
      keyLocation: 'https://clinica.sites.app/indexnow-key.txt',
      urlList: ['https://clinica.sites.app'],
    })
    expect(
      indexNowPayload({ baseUrl: 'https://a.b', key: 'k', urls: [] }),
    ).toBeNull()
    const many = Array.from(
      { length: INDEXNOW_MAX_URLS + 5 },
      (_, i) => `https://a.b/${i}`,
    )
    expect(
      indexNowPayload({ baseUrl: 'https://a.b', key: 'k', urls: many })
        ?.urlList,
    ).toHaveLength(INDEXNOW_MAX_URLS)
  })
})

describe('robots.txt', () => {
  it('describes every bot', () => {
    for (const bot of SITE_CRAWLER_BOTS) {
      expect(CRAWLER_INFO[bot].description.length).toBeGreaterThan(20)
    }
  })

  it('blocks everything on a noindex site', () => {
    expect(renderSearchRobotsTxt({ noindex: true, sitemapUrl: 'x' })).toBe(
      'User-agent: *\nDisallow: /\n',
    )
  })

  it('adds a group per blocked bot, the sitemap and the llms hint', () => {
    const txt = renderSearchRobotsTxt({
      noindex: false,
      sitemapUrl: 'https://s.app/sitemap.xml',
      crawlers: { GPTBot: false, CCBot: false, Googlebot: true },
      llmsUrl: 'https://s.app/llms.txt',
    })
    expect(txt).toBe(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: https://s.app/sitemap.xml\n\n# LLM-friendly summary: https://s.app/llms.txt\n',
    )
    expect(
      renderSearchRobotsTxt({
        noindex: false,
        sitemapUrl: 'https://s.app/sitemap.xml',
      }),
    ).toBe('User-agent: *\nAllow: /\n\nSitemap: https://s.app/sitemap.xml\n')
  })

  it('separates training bots from answer engines', () => {
    const crawlers = {
      GPTBot: false,
      PerplexityBot: false,
      'ChatGPT-User': false,
    }
    expect(blockedCrawlers(crawlers)).toEqual([
      'GPTBot',
      'ChatGPT-User',
      'PerplexityBot',
    ])
    expect(blockedAnswerEngines(crawlers)).toEqual([
      'ChatGPT-User',
      'PerplexityBot',
    ])
    expect(blockedCrawlers(undefined)).toEqual([])
  })
})
