import type { CanvasOp } from '@/src/lib/canvas/ops'
import type { CheckContext } from './context'
import { renderedTitle } from './context'
import {
  containsAny,
  countTerm,
  normalizeText,
  slugForm,
  truncateWords,
  wordsOf,
} from './text'
import type { SearchCheck, SearchCheckStatus } from './types'

/**
 * SEO (classic search: Google, Bing). Each check is deterministic, explains
 * itself in pt-BR and offers a fix when one exists. Pure.
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
    id: `seo.${id}`,
    label,
    weight,
    status,
    message,
    ...(fix ? { fix } : {}),
  }
}

export const TITLE_RANGE = { min: 30, max: 60 }
export const DESCRIPTION_RANGE = { min: 120, max: 160 }
export const MIN_WORDS = 300

function keywordCheck(ctx: CheckContext): Check {
  if (ctx.keyword) {
    const synonyms = ctx.search.synonyms?.length ?? 0
    return check(
      'keyword',
      'Palavra-chave principal',
      2,
      'pass',
      synonyms
        ? `“${ctx.keyword}” e ${synonyms} variação(ões) guiam as verificações.`
        : `“${ctx.keyword}” guia as verificações. Variações e sinônimos também contam.`,
    )
  }
  return check(
    'keyword',
    'Palavra-chave principal',
    6,
    'fail',
    'Defina a busca principal que esta página deve responder: as outras verificações de palavra-chave dependem dela.',
    { kind: 'open', label: 'Definir palavra-chave', target: 'keyword' },
  )
}

function titleLengthCheck(ctx: CheckContext): Check {
  const length = ctx.title.length
  const fix = {
    kind: 'ai',
    label: 'Sugerir título com IA',
    field: 'title',
  } as const
  if (length >= TITLE_RANGE.min && length <= TITLE_RANGE.max) {
    return check(
      'title-length',
      'Tamanho do título',
      3,
      'pass',
      `${length} caracteres: cabe inteiro no Google.`,
    )
  }
  if (length < TITLE_RANGE.min) {
    return check(
      'title-length',
      'Tamanho do título',
      3,
      length >= 20 ? 'warn' : 'fail',
      `${length} caracteres: curto demais. Use de ${TITLE_RANGE.min} a ${TITLE_RANGE.max} para descrever bem a página.`,
      fix,
    )
  }
  return check(
    'title-length',
    'Tamanho do título',
    3,
    length <= 70 ? 'warn' : 'fail',
    `${length} caracteres: o Google corta depois de ~${TITLE_RANGE.max}. Deixe o essencial no começo.`,
    fix,
  )
}

function descriptionCheck(ctx: CheckContext): Check {
  const length = ctx.description.length
  const first = ctx.content.blocks.find((block) => block.kind === 'text')
  const fromContent =
    first && first.words >= 12
      ? truncateWords(first.text, DESCRIPTION_RANGE.max - 5)
      : null
  const fix =
    fromContent && !ctx.input.page.seo.description
      ? ({
          kind: 'patch',
          label: 'Usar o primeiro parágrafo',
          set: { description: fromContent },
        } as const)
      : ({
          kind: 'ai',
          label: 'Sugerir descrição com IA',
          field: 'description',
        } as const)
  if (!length) {
    return check(
      'description',
      'Meta descrição',
      3,
      'fail',
      'Sem descrição: o Google escolhe um trecho qualquer da página.',
      fix,
    )
  }
  if (length >= DESCRIPTION_RANGE.min && length <= DESCRIPTION_RANGE.max) {
    return check(
      'description',
      'Meta descrição',
      3,
      'pass',
      `${length} caracteres: tamanho ideal.`,
    )
  }
  const warn = length >= 70 && length <= 200
  return check(
    'description',
    'Meta descrição',
    3,
    warn ? 'warn' : 'fail',
    length < DESCRIPTION_RANGE.min
      ? `${length} caracteres: curta. Use de ${DESCRIPTION_RANGE.min} a ${DESCRIPTION_RANGE.max} com um convite ao clique.`
      : `${length} caracteres: o Google corta depois de ~${DESCRIPTION_RANGE.max}.`,
    fix,
  )
}

function keywordIn(
  ctx: CheckContext,
  id: string,
  label: string,
  weight: number,
  value: string,
  where: string,
  fix?: SearchCheck['fix'],
): Check {
  return containsAny(value, ctx.terms)
    ? check(id, label, weight, 'pass', `A palavra-chave aparece ${where}.`)
    : check(
        id,
        label,
        weight,
        'warn',
        `A palavra-chave não aparece ${where}. Os buscadores destacam os termos que a pessoa buscou.`,
        fix,
      )
}

function slugCheck(ctx: CheckContext): Check {
  const { page } = ctx.input
  if (page.isHome) {
    return check(
      'slug',
      'Endereço da página',
      1,
      'pass',
      'A página inicial fica na raiz do site.',
    )
  }
  const words = page.slug.split('-').filter(Boolean).length
  const open = {
    kind: 'open',
    label: 'Editar endereço',
    target: 'page-settings',
  } as const
  if (page.slug.length > 60 || words > 6) {
    return check(
      'slug',
      'Endereço da página',
      1,
      'warn',
      `“/${page.slug}” é longo. Endereços curtos e descritivos funcionam melhor.`,
      open,
    )
  }
  if (ctx.keyword) {
    const key = slugForm(ctx.keyword)
    const matches = ctx.terms.some((term) => page.slug.includes(slugForm(term)))
    if (key && !matches) {
      return check(
        'slug',
        'Endereço da página',
        1,
        'warn',
        `Inclua a palavra-chave no endereço (ex.: /${key}).`,
        open,
      )
    }
  }
  return check(
    'slug',
    'Endereço da página',
    1,
    'pass',
    `“/${page.slug}” é curto e descritivo.`,
  )
}

function h1Check(ctx: CheckContext): Check {
  const headings = ctx.content.headings
  const h1s = headings.filter((heading) => heading.level === 1)
  if (h1s.length === 1) {
    return check(
      'h1',
      'Título principal (H1)',
      3,
      'pass',
      'A página tem um único H1.',
    )
  }
  if (h1s.length === 0) {
    const first = headings[0]
    return check(
      'h1',
      'Título principal (H1)',
      3,
      'fail',
      'Nenhum título está marcado como H1: os buscadores não sabem qual é o assunto principal.',
      first
        ? {
            kind: 'canvas',
            label: 'Transformar o primeiro título em H1',
            ops: [{ kind: 'update', id: first.id, set: { level: 'h1' } }],
          }
        : undefined,
    )
  }
  const ops: CanvasOp[] = h1s.slice(1).map((heading) => ({
    kind: 'update',
    id: heading.id,
    set: { level: 'h2' },
  }))
  return check(
    'h1',
    'Título principal (H1)',
    3,
    'fail',
    `${h1s.length} títulos H1: deixe só um e use H2 para as seções.`,
    { kind: 'canvas', label: 'Rebaixar os outros para H2', ops },
  )
}

/** First heading that skips a level (H2 → H4), or `null`. */
export function skippedHeading(ctx: CheckContext) {
  let previous = 0
  for (const heading of ctx.content.headings) {
    if (previous && heading.level > previous + 1) return { heading, previous }
    previous = heading.level
  }
  return null
}

function headingOrderCheck(ctx: CheckContext): Check {
  const skipped = skippedHeading(ctx)
  if (!skipped) {
    return check(
      'heading-order',
      'Hierarquia dos títulos',
      1,
      'pass',
      'Os títulos seguem a ordem H1 → H2 → H3.',
    )
  }
  return check(
    'heading-order',
    'Hierarquia dos títulos',
    1,
    'warn',
    `“${truncateWords(skipped.heading.text, 40)}” é H${skipped.heading.level} logo depois de um H${skipped.previous}. Não pule níveis.`,
    {
      kind: 'select',
      label: 'Selecionar o título',
      nodeId: skipped.heading.id,
    },
  )
}

function imageAltCheck(ctx: CheckContext): Check {
  const images = ctx.content.images
  if (images.length === 0) {
    return check(
      'image-alt',
      'Texto alternativo das imagens',
      2,
      'pass',
      'A página não tem imagens.',
    )
  }
  const missing = images.filter((image) => !image.alt)
  if (missing.length === 0) {
    return check(
      'image-alt',
      'Texto alternativo das imagens',
      2,
      'pass',
      `Todas as ${images.length} imagens têm texto alternativo.`,
    )
  }
  const covered = 1 - missing.length / images.length
  return check(
    'image-alt',
    'Texto alternativo das imagens',
    2,
    covered >= 0.8 ? 'warn' : 'fail',
    `${missing.length} de ${images.length} imagens sem texto alternativo. Ele descreve a imagem para buscadores e leitores de tela.`,
    { kind: 'select', label: 'Selecionar a imagem', nodeId: missing[0].id },
  )
}

function linksCheck(ctx: CheckContext, internal: boolean): Check {
  const count = ctx.content.links.filter(
    (link) => link.internal === internal,
  ).length
  if (internal) {
    return count
      ? check(
          'internal-links',
          'Links internos',
          1,
          'pass',
          `${count} link(s) para outras páginas ou seções do site.`,
        )
      : check(
          'internal-links',
          'Links internos',
          1,
          'warn',
          'Nenhum link para outras páginas do site: eles ajudam os buscadores a descobrir o resto do conteúdo.',
        )
  }
  return count
    ? check(
        'external-links',
        'Links externos',
        1,
        'pass',
        `${count} link(s) para outros sites.`,
      )
    : check(
        'external-links',
        'Links externos',
        1,
        'warn',
        'Nenhum link para fontes externas. Citar referências dá contexto ao conteúdo.',
      )
}

function wordCountCheck(ctx: CheckContext): Check {
  const words = ctx.content.words
  if (words >= MIN_WORDS) {
    return check(
      'word-count',
      'Quantidade de texto',
      2,
      'pass',
      `${words} palavras.`,
    )
  }
  return check(
    'word-count',
    'Quantidade de texto',
    2,
    words >= 150 ? 'warn' : 'fail',
    `${words} palavras. Páginas com pelo menos ${MIN_WORDS} palavras costumam responder melhor à busca.`,
  )
}

function keywordUsageCheck(ctx: CheckContext): Check {
  const words = ctx.content.words
  const keywordWords = Math.max(1, wordsOf(ctx.keyword ?? '').length)
  const occurrences = ctx.terms.reduce(
    (sum, term) => sum + countTerm(ctx.content.text, term),
    0,
  )
  const label = 'Palavra-chave no conteúdo'
  if (occurrences === 0) {
    return check(
      'keyword-usage',
      label,
      2,
      'fail',
      'A palavra-chave não aparece no texto da página.',
    )
  }
  const density = words ? (occurrences * keywordWords) / words : 1
  if (density > 0.03) {
    return check(
      'keyword-usage',
      label,
      2,
      'warn',
      `A palavra-chave aparece ${occurrences} vezes (${(density * 100).toFixed(1)}% do texto): repetição demais soa artificial. Use variações.`,
    )
  }
  const opening = ctx.content.blocks
    .slice(0, 2)
    .map((block) => block.text)
    .join(' ')
  if (!containsAny(opening, ctx.terms)) {
    return check(
      'keyword-usage',
      label,
      2,
      'warn',
      `A palavra-chave aparece ${occurrences} vez(es), mas não no começo. Cite-a no primeiro parágrafo.`,
    )
  }
  return check(
    'keyword-usage',
    label,
    2,
    'pass',
    `A palavra-chave aparece ${occurrences} vez(es), inclusive no começo.`,
  )
}

function uniquenessCheck(ctx: CheckContext): Check {
  const { settings } = ctx.input.site
  const title = normalizeText(ctx.title)
  const description = normalizeText(ctx.input.page.seo.description ?? '')
  const sameTitle = ctx.input.siblings.filter(
    (other) => normalizeText(renderedTitle(settings, other)) === title,
  )
  if (sameTitle.length) {
    return check(
      'unique',
      'Título e descrição únicos',
      2,
      'fail',
      `O título é igual ao de “${sameTitle[0].title}”. Cada página precisa de um título próprio.`,
      { kind: 'ai', label: 'Sugerir título com IA', field: 'title' },
    )
  }
  const sameDescription = description
    ? ctx.input.siblings.filter(
        (other) => normalizeText(other.seo.description ?? '') === description,
      )
    : []
  if (sameDescription.length) {
    return check(
      'unique',
      'Título e descrição únicos',
      2,
      'warn',
      `A descrição é igual à de “${sameDescription[0].title}”.`,
      { kind: 'ai', label: 'Sugerir descrição com IA', field: 'description' },
    )
  }
  return check(
    'unique',
    'Título e descrição únicos',
    2,
    'pass',
    'Nenhuma outra página do site usa o mesmo título ou descrição.',
  )
}

function indexableCheck(ctx: CheckContext): Check {
  const { settings } = ctx.input.site
  if (settings.seo.noindex) {
    return check(
      'indexable',
      'Visível nos buscadores',
      4,
      'fail',
      'O site inteiro está escondido dos buscadores (Configurações do site).',
    )
  }
  if (ctx.input.page.seo.noindex) {
    return check(
      'indexable',
      'Visível nos buscadores',
      4,
      'fail',
      'Esta página está marcada para não aparecer nos buscadores.',
      { kind: 'open', label: 'Abrir configurações', target: 'page-settings' },
    )
  }
  return check(
    'indexable',
    'Visível nos buscadores',
    4,
    'pass',
    'A página pode ser indexada.',
  )
}

function canonicalCheck(ctx: CheckContext): Check {
  const canonical = ctx.input.page.seo.canonicalUrl
  if (canonical && canonical !== ctx.input.site.pageUrl) {
    return check(
      'canonical',
      'Endereço canônico',
      1,
      'warn',
      `O canônico aponta para ${canonical}: os buscadores vão mostrar aquele endereço no lugar deste.`,
      { kind: 'open', label: 'Revisar canônico', target: 'page-settings' },
    )
  }
  return check(
    'canonical',
    'Endereço canônico',
    1,
    'pass',
    'A página é o próprio endereço canônico.',
  )
}

function socialCheck(ctx: CheckContext): Check {
  const own =
    ctx.input.page.seo.socialImageUrl || ctx.input.site.settings.socialImageUrl
  return own
    ? check(
        'social',
        'Prévia nas redes sociais',
        1,
        'pass',
        'Tem imagem própria para WhatsApp, LinkedIn e redes.',
      )
    : check(
        'social',
        'Prévia nas redes sociais',
        1,
        'warn',
        'Sem imagem própria: as redes mostram o cartão gerado com o título. Uma foto de 1200 × 630 px chama mais atenção.',
        { kind: 'open', label: 'Escolher imagem', target: 'page-settings' },
      )
}

export function seoChecks(ctx: CheckContext): Check[] {
  const h1 = ctx.content.headings.find((heading) => heading.level === 1)
  const checks: Check[] = [keywordCheck(ctx), titleLengthCheck(ctx)]
  if (ctx.keyword) {
    checks.push(
      keywordIn(
        ctx,
        'title-keyword',
        'Palavra-chave no título',
        3,
        ctx.title,
        'no título',
        {
          kind: 'ai',
          label: 'Sugerir título com IA',
          field: 'title',
        },
      ),
    )
  }
  checks.push(descriptionCheck(ctx))
  if (ctx.keyword && ctx.description) {
    checks.push(
      keywordIn(
        ctx,
        'description-keyword',
        'Palavra-chave na descrição',
        2,
        ctx.description,
        'na descrição',
        {
          kind: 'ai',
          label: 'Sugerir descrição com IA',
          field: 'description',
        },
      ),
    )
  }
  checks.push(slugCheck(ctx), h1Check(ctx))
  if (ctx.keyword && h1) {
    checks.push(
      keywordIn(ctx, 'h1-keyword', 'Palavra-chave no H1', 2, h1.text, 'no H1', {
        kind: 'select',
        label: 'Selecionar o H1',
        nodeId: h1.id,
      }),
    )
  }
  checks.push(
    headingOrderCheck(ctx),
    imageAltCheck(ctx),
    linksCheck(ctx, true),
    linksCheck(ctx, false),
    wordCountCheck(ctx),
  )
  if (ctx.keyword) checks.push(keywordUsageCheck(ctx))
  checks.push(
    uniquenessCheck(ctx),
    indexableCheck(ctx),
    canonicalCheck(ctx),
    socialCheck(ctx),
  )
  return checks
}
