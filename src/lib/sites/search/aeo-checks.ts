import type { CheckContext } from './context'
import { countWords, isQuestion, normalizeText } from './text'
import type { SearchCheck, SearchCheckStatus } from './types'

/**
 * AEO (answer engines: featured snippets, "People also ask", voice
 * assistants). They lift a short, direct answer that sits right after a
 * question, and lists and tables. Pure.
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
    id: `aeo.${id}`,
    label,
    weight,
    status,
    message,
    ...(fix ? { fix } : {}),
  }
}

/** Ideal length of a direct answer (words). */
export const ANSWER_RANGE = { min: 40, max: 60 }

/** Question headings of the page with the block that follows each. */
export function questionAnswers(
  ctx: CheckContext,
): Array<{ id: string; question: string; answer: string | null }> {
  const out: Array<{ id: string; question: string; answer: string | null }> = []
  const flow = ctx.content.flow
  flow.forEach((item, index) => {
    if (item.type !== 'heading' || !isQuestion(item.text)) return
    const next = flow[index + 1]
    out.push({
      id: item.id,
      question: item.text,
      answer: next?.type === 'block' ? next.text : null,
    })
  })
  return out
}

function answerQuality(answer: string | null): number {
  if (!answer) return 0
  const words = countWords(answer)
  if (words >= ANSWER_RANGE.min && words <= ANSWER_RANGE.max) return 1
  if (words >= 25 && words <= 90) return 0.5
  return 0
}

function questionHeadingsCheck(ctx: CheckContext): Check {
  const count = questionAnswers(ctx).length
  const label = 'Títulos em forma de pergunta'
  const fix = {
    kind: 'open',
    label: 'Cadastrar perguntas',
    target: 'questions',
  } as const
  if (count >= 3) {
    return check(
      'question-headings',
      label,
      3,
      'pass',
      `${count} títulos fazem perguntas que as pessoas buscam.`,
    )
  }
  return check(
    'question-headings',
    label,
    3,
    count ? 'warn' : 'fail',
    count
      ? `${count} título(s) em forma de pergunta. Com 3 ou mais a página aparece em mais caixas de “As pessoas também perguntam”.`
      : 'Nenhum título faz uma pergunta. Escreva seções como “Quanto custa…?” ou “Como funciona…?”.',
    fix,
  )
}

function directAnswersCheck(ctx: CheckContext): Check {
  const pairs = [
    ...questionAnswers(ctx).map((pair) => pair.answer),
    ...(ctx.search.questions ?? []).map((item) => item.answer || null),
  ]
  const label = 'Respostas diretas (40–60 palavras)'
  const fix = {
    kind: 'ai',
    label: 'Escrever respostas com IA',
    field: 'answers',
  } as const
  if (pairs.length === 0) {
    return check(
      'direct-answers',
      label,
      3,
      'warn',
      'Sem perguntas para avaliar as respostas.',
      {
        kind: 'open',
        label: 'Cadastrar perguntas',
        target: 'questions',
      },
    )
  }
  const quality =
    pairs.reduce((sum, answer) => sum + answerQuality(answer), 0) / pairs.length
  const good = pairs.filter((answer) => answerQuality(answer) === 1).length
  const message = `${good} de ${pairs.length} perguntas têm logo depois uma resposta de ${ANSWER_RANGE.min} a ${ANSWER_RANGE.max} palavras, o trecho que os buscadores copiam.`
  if (quality >= 0.7) return check('direct-answers', label, 3, 'pass', message)
  return check(
    'direct-answers',
    label,
    3,
    quality >= 0.4 ? 'warn' : 'fail',
    message,
    fix,
  )
}

function faqCheck(ctx: CheckContext): Check {
  const label = 'Perguntas frequentes (FAQPage)'
  if (ctx.content.faq.length) {
    return check(
      'faq',
      label,
      2,
      'pass',
      `${ctx.content.faq.length} pergunta(s) em acordeão viram dados estruturados FAQPage.`,
    )
  }
  const answered = (ctx.search.questions ?? []).filter((item) => item.answer)
  if (answered.length) {
    return check(
      'faq',
      label,
      2,
      'fail',
      'As perguntas cadastradas ainda não aparecem na página. O Google só aceita FAQ visível para o visitante.',
      { kind: 'insert-faq', label: 'Inserir como seção de perguntas' },
    )
  }
  return check(
    'faq',
    label,
    2,
    'fail',
    'A página não tem perguntas frequentes em acordeão.',
    {
      kind: 'open',
      label: 'Cadastrar perguntas',
      target: 'questions',
    },
  )
}

/** The page reads like instructions (numbered list or a "Como…" title). */
export function looksLikeHowTo(ctx: CheckContext): boolean {
  return (
    ctx.content.numberedLists > 0 ||
    ctx.content.headings.some((heading) => {
      const text = normalizeText(heading.text)
      // "Como instalar…" teaches; "Como funciona?" asks.
      return (
        text.startsWith('passo ') ||
        (text.startsWith('como ') && !text.endsWith('?'))
      )
    })
  )
}

function howToCheck(ctx: CheckContext): Check {
  const label = 'Passo a passo (HowTo)'
  const has = ctx.search.structuredData?.some((item) => item.type === 'HowTo')
  if (has)
    return check(
      'howto',
      label,
      1,
      'pass',
      'Os passos estão marcados como HowTo.',
    )
  if (looksLikeHowTo(ctx)) {
    return check(
      'howto',
      label,
      1,
      'warn',
      'A página parece ensinar um passo a passo. Marque os passos como HowTo para os assistentes lerem em ordem.',
      { kind: 'open', label: 'Adicionar HowTo', target: 'structured' },
    )
  }
  return check(
    'howto',
    label,
    1,
    'pass',
    'Não se aplica: a página não traz instruções em passos.',
  )
}

function listsCheck(ctx: CheckContext): Check {
  const count = ctx.content.lists + ctx.content.tables
  return count
    ? check(
        'lists',
        'Listas e tabelas',
        2,
        'pass',
        `${count} lista(s) ou tabela(s): formato que vira trecho em destaque.`,
      )
    : check(
        'lists',
        'Listas e tabelas',
        2,
        'warn',
        'Nenhuma lista ou tabela. Etapas, vantagens e comparações em lista têm mais chance de virar trecho em destaque.',
      )
}

function speakableCheck(ctx: CheckContext): Check {
  const summary = ctx.search.summary ?? ''
  const words = countWords(summary)
  const label = 'Resumo para assistentes de voz'
  if (!summary) {
    return check(
      'speakable',
      label,
      1,
      'fail',
      'Escreva um resumo de 1 a 3 frases: é o que assistentes de voz e IAs leem primeiro.',
      { kind: 'open', label: 'Escrever resumo', target: 'summary' },
    )
  }
  if (words < 20 || words > 60) {
    return check(
      'speakable',
      label,
      1,
      'warn',
      `O resumo tem ${words} palavras; o ideal para ser lido em voz alta é de 20 a 60.`,
      {
        kind: 'open',
        label: 'Ajustar resumo',
        target: 'summary',
      },
    )
  }
  if (!ctx.search.speakable) {
    return check(
      'speakable',
      label,
      1,
      'warn',
      'O resumo está pronto, mas título e descrição não estão marcados como “falável” (speakable).',
      {
        kind: 'patch',
        label: 'Marcar como falável',
        set: { search: { speakable: true } },
      },
    )
  }
  return check(
    'speakable',
    label,
    1,
    'pass',
    'Resumo no tamanho certo e marcado como falável.',
  )
}

function questionsEditorCheck(ctx: CheckContext): Check {
  const answered = (ctx.search.questions ?? []).filter(
    (item) => item.answer,
  ).length
  const label = 'Perguntas que este conteúdo responde'
  const fix = {
    kind: 'open',
    label: 'Cadastrar perguntas',
    target: 'questions',
  } as const
  if (answered >= 3)
    return check(
      'questions',
      label,
      2,
      'pass',
      `${answered} perguntas com resposta cadastradas.`,
    )
  return check(
    'questions',
    label,
    2,
    answered ? 'warn' : 'fail',
    answered
      ? `${answered} pergunta(s) com resposta. Cadastre pelo menos 3 das dúvidas reais dos clientes.`
      : 'Cadastre as dúvidas que os clientes digitam na busca e responda cada uma de forma direta.',
    fix,
  )
}

function concisionCheck(ctx: CheckContext): Check {
  const texts = ctx.content.blocks.filter((block) => block.kind === 'text')
  const label = 'Parágrafos objetivos'
  if (texts.length === 0) {
    return check(
      'concise',
      label,
      1,
      'warn',
      'A página não tem blocos de texto.',
    )
  }
  const average = Math.round(
    texts.reduce((sum, block) => sum + block.words, 0) / texts.length,
  )
  if (average <= 80)
    return check(
      'concise',
      label,
      1,
      'pass',
      `Blocos de texto com ${average} palavras em média.`,
    )
  return check(
    'concise',
    label,
    1,
    average <= 120 ? 'warn' : 'fail',
    `Blocos de texto com ${average} palavras em média. Parágrafos curtos são mais fáceis de citar.`,
  )
}

export function aeoChecks(ctx: CheckContext): Check[] {
  return [
    questionHeadingsCheck(ctx),
    directAnswersCheck(ctx),
    faqCheck(ctx),
    questionsEditorCheck(ctx),
    listsCheck(ctx),
    howToCheck(ctx),
    speakableCheck(ctx),
    concisionCheck(ctx),
  ]
}
