import { napConsistency, profileCompleteness } from './business'
import type { CheckContext } from './context'
import { blockedAnswerEngines } from './robots'
import { skippedHeading } from './seo-checks'
import { validateStructuredData } from './structured-data'
import { countWords, isFactual, sentencesOf } from './text'
import type { SearchCheck, SearchCheckStatus } from './types'

/**
 * GEO (generative engines: ChatGPT, Perplexity, Gemini, Google AI
 * Overviews). They cite pages whose entity is unambiguous, that state
 * verifiable facts with sources, are fresh and easy to parse. Pure.
 */

type Check = Omit<SearchCheck, 'pillar'>

function check(
  id: string,
  label: string,
  weight: number,
  status: SearchCheckStatus,
  message: string,
  fix?: SearchCheck['fix'],
): Check {
  return {
    id: `geo.${id}`,
    label,
    weight,
    status,
    message,
    ...(fix ? { fix } : {}),
  }
}

const DAY_MS = 86_400_000

/** Domains engines treat as reference sources. */
const AUTHORITATIVE = [
  /\.gov(\.[a-z]{2})?$/,
  /\.gov\.br$/,
  /\.jus\.br$/,
  /\.leg\.br$/,
  /\.edu(\.[a-z]{2})?$/,
  /\.org(\.[a-z]{2})?$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)ibge\.gov\.br$/,
  /(^|\.)who\.int$/,
  /(^|\.)scielo\.(br|org)$/,
  /(^|\.)ncbi\.nlm\.nih\.gov$/,
]

export function isAuthoritative(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase()
    return AUTHORITATIVE.some((pattern) => pattern.test(host))
  } catch {
    return false
  }
}

function entityCheck(ctx: CheckContext): Check {
  const { percent, missing } = profileCompleteness(ctx.business)
  const label = 'Entidade clara (Perfil do negócio)'
  const fix = {
    kind: 'open',
    label: 'Completar perfil',
    target: 'business',
  } as const
  if (percent >= 80) {
    return check(
      'entity',
      label,
      3,
      'pass',
      `Perfil do negócio ${percent}% completo: as IAs sabem quem é a empresa.`,
    )
  }
  return check(
    'entity',
    label,
    3,
    percent >= 50 ? 'warn' : 'fail',
    `Perfil do negócio ${percent}% completo. Falta: ${missing.slice(0, 4).join(', ')}.`,
    fix,
  )
}

function napCheck(ctx: CheckContext): Check {
  const label = 'Nome, endereço e telefone consistentes'
  const status = napConsistency(
    ctx.business,
    `${ctx.content.text} ${ctx.input.chromeText ?? ''}`,
  )
  const fix = {
    kind: 'open',
    label: 'Abrir perfil',
    target: 'business',
  } as const
  switch (status) {
    case 'consistent':
      return check(
        'nap',
        label,
        1,
        'pass',
        'O telefone do site é o mesmo do perfil do negócio.',
      )
    case 'conflict':
      return check(
        'nap',
        label,
        1,
        'fail',
        'O site mostra um telefone diferente do perfil do negócio. Dados divergentes fazem as IAs desconfiarem dos dois.',
        fix,
      )
    case 'missing':
      return check(
        'nap',
        label,
        1,
        'warn',
        'O telefone do perfil não aparece na página, no cabeçalho nem no rodapé.',
      )
    default:
      return check(
        'nap',
        label,
        1,
        'warn',
        'Cadastre o telefone no perfil do negócio para conferir a consistência.',
        fix,
      )
  }
}

function factsCheck(ctx: CheckContext): Check {
  const facts = ctx.content.blocks
    .flatMap((block) => sentencesOf(block.text))
    .filter(isFactual).length
  const label = 'Fatos verificáveis'
  if (facts >= 3) {
    return check(
      'facts',
      label,
      2,
      'pass',
      `${facts} frases com números, datas ou valores: dados que as IAs podem citar.`,
    )
  }
  return check(
    'facts',
    label,
    2,
    facts ? 'warn' : 'fail',
    facts
      ? `Só ${facts} frase(s) com números ou datas. Traga dados concretos: anos de experiência, clientes atendidos, prazos, preços.`
      : 'Nenhuma frase com números, datas ou valores. Afirmações concretas são as mais citadas pelas IAs.',
  )
}

function summaryTopCheck(ctx: CheckContext): Check {
  const label = 'Resumo citável no topo'
  const first = ctx.content.blocks.find((block) => block.kind === 'text')
  const summary = ctx.search.summary ?? ''
  const summaryWords = countWords(summary)
  const firstOk = first && first.words >= 25 && first.words <= 80
  if (firstOk) {
    return check(
      'summary-top',
      label,
      2,
      'pass',
      `O primeiro parágrafo (${first.words} palavras) resume a página.`,
    )
  }
  if (summaryWords >= 20 && summaryWords <= 80) {
    return check(
      'summary-top',
      label,
      2,
      'warn',
      'O resumo está cadastrado, mas a página não abre com ele. Mostre-o logo abaixo do título.',
      { kind: 'insert-summary', label: 'Inserir resumo abaixo do H1' },
    )
  }
  return check(
    'summary-top',
    label,
    2,
    'fail',
    'A página não abre com um parágrafo de 25 a 80 palavras que diga o que é, para quem e por quê.',
    { kind: 'open', label: 'Escrever resumo', target: 'summary' },
  )
}

function citationsCheck(ctx: CheckContext): Check {
  const external = ctx.content.links.filter((link) => !link.internal)
  const authoritative = external.filter((link) => isAuthoritative(link.href))
  const label = 'Fontes e citações'
  if (authoritative.length) {
    return check(
      'citations',
      label,
      2,
      'pass',
      `${authoritative.length} link(s) para fontes de referência (governo, universidades, organizações).`,
    )
  }
  return check(
    'citations',
    label,
    2,
    external.length ? 'warn' : 'fail',
    external.length
      ? 'Há links externos, mas nenhum para uma fonte de referência (.gov.br, .edu, .org, Wikipédia).'
      : 'Nenhuma fonte citada. Linkar dados oficiais e estudos aumenta a confiança das IAs no conteúdo.',
  )
}

function freshnessCheck(ctx: CheckContext): Check {
  const label = 'Conteúdo atualizado'
  const updated = ctx.input.page.updatedAt
    ? Date.parse(ctx.input.page.updatedAt)
    : Number.NaN
  if (Number.isNaN(updated)) {
    return check(
      'freshness',
      label,
      2,
      'warn',
      'Sem data de atualização conhecida.',
    )
  }
  const days = Math.max(
    0,
    Math.floor((ctx.input.now.getTime() - updated) / DAY_MS),
  )
  const when = days === 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`
  if (days > 365) {
    return check(
      'freshness',
      label,
      2,
      'fail',
      `Atualizada ${when}. Revise os dados: conteúdo antigo perde espaço nas respostas das IAs.`,
    )
  }
  if (days > 180) {
    return check(
      'freshness',
      label,
      2,
      'warn',
      `Atualizada ${when}. Uma revisão a cada seis meses mantém a página nas respostas.`,
    )
  }
  if (!ctx.search.showUpdatedDate) {
    return check(
      'freshness',
      label,
      2,
      'warn',
      `Atualizada ${when}, mas a data não aparece para o visitante. A data visível (e no schema) sinaliza conteúdo fresco.`,
      {
        kind: 'patch',
        label: 'Mostrar data de atualização',
        set: { search: { showUpdatedDate: true } },
      },
    )
  }
  return check(
    'freshness',
    label,
    2,
    'pass',
    `Atualizada ${when}, com a data visível e no schema.`,
  )
}

function structuredCheck(ctx: CheckContext): Check {
  const items = ctx.search.structuredData ?? []
  const label = 'Dados estruturados'
  const fix = {
    kind: 'open',
    label: 'Editar dados estruturados',
    target: 'structured',
  } as const
  const invalid = items
    .map((item) => ({
      item,
      missing: validateStructuredData(item, {
        pageTitle: ctx.title,
        description: ctx.description,
        faqCount: ctx.content.faq.length,
        business: ctx.business,
      }),
    }))
    .filter((entry) => entry.missing.length)
  if (invalid.length) {
    const [first] = invalid
    return check(
      'structured',
      label,
      2,
      'fail',
      `${first.item.type}: falta ${first.missing.join(', ')}.`,
      fix,
    )
  }
  const types = new Set(items.map((item) => item.type))
  if (ctx.content.faq.length) types.add('FAQPage')
  if (types.size) {
    return check(
      'structured',
      label,
      2,
      'pass',
      `Organization, WebPage e ${[...types].join(', ')} publicados.`,
    )
  }
  return check(
    'structured',
    label,
    2,
    'warn',
    'Só os dados básicos (Organization, WebPage, BreadcrumbList). Diga o que a página é: serviço, produto, artigo, evento.',
    fix,
  )
}

function semanticCheck(ctx: CheckContext): Check {
  const problems: string[] = []
  const h1s = ctx.content.headings.filter(
    (heading) => heading.level === 1,
  ).length
  if (h1s !== 1) problems.push(h1s ? 'mais de um H1' : 'sem H1')
  if (skippedHeading(ctx)) problems.push('títulos pulando níveis')
  if (ctx.content.images.some((image) => !image.alt))
    problems.push('imagens sem texto alternativo')
  const label = 'HTML semântico'
  if (problems.length === 0) {
    return check(
      'semantic',
      label,
      1,
      'pass',
      'Estrutura limpa: um H1, títulos em ordem e imagens descritas.',
    )
  }
  return check(
    'semantic',
    label,
    1,
    problems.length === 1 ? 'warn' : 'fail',
    `Corrija: ${problems.join(', ')}.`,
  )
}

function accessCheck(ctx: CheckContext): Check {
  const label = 'Acesso das IAs ao conteúdo'
  const fix = {
    kind: 'open',
    label: 'Rastreadores e feeds',
    target: 'crawlers',
  } as const
  if (ctx.input.site.settings.seo.noindex || ctx.input.page.seo.noindex) {
    return check(
      'ai-access',
      label,
      2,
      'fail',
      'A página está escondida dos buscadores, então as IAs também não a citam.',
    )
  }
  const blocked = blockedAnswerEngines(ctx.settings.crawlers)
  if (blocked.length) {
    return check(
      'ai-access',
      label,
      2,
      'warn',
      `Bloqueados no robots.txt: ${blocked.join(', ')}. Eles não podem citar o site.`,
      fix,
    )
  }
  if (!ctx.settings.llms.enabled) {
    return check(
      'ai-access',
      label,
      2,
      'warn',
      'O llms.txt está desligado: as IAs perdem o resumo do site.',
      fix,
    )
  }
  return check(
    'ai-access',
    label,
    2,
    'pass',
    'Buscadores de IA liberados e llms.txt publicado.',
  )
}

export function geoChecks(ctx: CheckContext): Check[] {
  return [
    entityCheck(ctx),
    napCheck(ctx),
    factsCheck(ctx),
    summaryTopCheck(ctx),
    citationsCheck(ctx),
    freshnessCheck(ctx),
    structuredCheck(ctx),
    semanticCheck(ctx),
    accessCheck(ctx),
  ]
}
