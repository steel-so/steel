import { UNTRUSTED_CONTENT_POLICY } from '@/src/lib/ai/guardrails/injection'
import { SITE_FONTS } from '@/src/lib/canvas-site/theme'
import { structuredCall } from '@/src/lib/site-ai/run'
import {
  SITE_AI_SECTION_HINTS,
  SITE_AI_SECTIONS,
} from '@/src/lib/site-ai/sections'
import {
  DESIGN_SPEC_JSON_SCHEMA,
  type DesignSpec,
  designSpecProblems,
  designSpecSchema,
  normalizeDesignSpec,
} from './design-spec'
import { type FidelityLlm, runLimited } from './llm'
import { blocksPrompt, isAnalyzable, type ReferenceSource } from './references'

/**
 * Visual analysis: a vision model looks at ONE reference (the capture's
 * strips plus the DOM blocks with computed styles, or the user's picture)
 * and answers a `DesignSpec`. One call per reference, a few at a time. A
 * reference that fails is reported and skipped; the generation goes on
 * with the others (or falls back to the ready sections when none works).
 */

export const ANALYSIS_MAX_TOKENS = 8_000
export const ANALYSIS_CONCURRENCY = 3

export function buildAnalysisSystem(): string {
  return [
    'Você é um designer de interfaces que mede o design de sites com precisão de engenheiro.',
    'Você recebe imagens de UMA referência (faixas de uma página, de cima para baixo, ou uma captura/foto enviada pelo cliente) e, quando existirem, os blocos do DOM com os estilos computados. Devolva só o JSON da DesignSpec.',
    'Meça, não opine:',
    '- Cores: use SEMPRE valores #rrggbb. Quando houver blocos do DOM, as cores dos estilos computados são as reais — prefira-as; sem DOM, leia os pixels com o máximo de cuidado (fundo, texto, botão, cartões, bordas). Dê um papel a cada cor.',
    `- Tipografia: escolha em headingFont/bodyFont a fonte do catálogo mais próxima (${SITE_FONTS.map((font) => `"${font.id}" = ${font.label}`).join(', ')}); registre o nome da fonte real em observedHeadingFont/observedBodyFont. Tamanhos em px na largura de desktop (se a referência for uma captura menor, escale para ~1440px); pesos de 100 a 900.`,
    '- Botões: raio, preenchimento (solid, outline, ghost, link), tamanho, caixa alta ou não. Cartões: raio, sombra (none, soft, medium, strong), borda, fundo, padding interno.',
    '- Espaçamento: padding vertical típico das seções, largura máxima do conteúdo e espaço entre itens de grade, em px.',
    '- sections: TODAS as seções da referência, de cima para baixo, na ordem. Para cada uma: tipo livre, o layout (colunas, alinhamento, o que fica onde), fundo, altura mínima, densidade, elementos em ordem, lado e proporção da imagem. yStart/yEnd só quando houver blocos do DOM (px da janela de captura); senão null.',
    `- equivalent: a seção pronta do gerador mais parecida com cada seção da referência, entre: ${SITE_AI_SECTIONS.map((type) => `${type} (${SITE_AI_SECTION_HINTS[type]})`).join('; ')}.`,
    'Descreva só o DESIGN. Não transcreva textos, slogans, nomes de marca, preços nem dados da referência, e não descreva logos ou fotos além do estilo e da proporção.',
    UNTRUSTED_CONTENT_POLICY,
  ].join('\n')
}

export function buildAnalysisMessage(
  source: ReferenceSource,
  focus: string,
): string {
  return [
    `Referência: ${source.label} (${source.kind === 'link' ? 'página da web' : 'imagem enviada pelo cliente'}).`,
    source.images.length > 0
      ? `Imagens anexas: ${source.images.length}${source.kind === 'link' ? ' (faixas consecutivas da página, de cima para baixo)' : ''}.`
      : 'Sem imagens: use só o resumo e os blocos abaixo.',
    ...(focus ? [`O que o cliente quer aproveitar: ${focus}`] : []),
    ...(source.capture ? blocksPrompt(source.capture) : []),
    ...(source.summary ? ['Resumo de texto da página:', source.summary] : []),
  ].join('\n')
}

export type AnalysisOutcome =
  | { ok: true; source: ReferenceSource; spec: DesignSpec }
  | { ok: false; source: ReferenceSource; problems: string[] }

export async function analyzeReference(input: {
  llm: FidelityLlm
  source: ReferenceSource
  focus: string
}): Promise<AnalysisOutcome> {
  const { llm, source } = input
  const answer = await structuredCall({
    provider: llm.provider,
    model: llm.model,
    system: buildAnalysisSystem(),
    message: buildAnalysisMessage(source, input.focus),
    images: source.images,
    schemaName: 'design_spec',
    jsonSchema: DESIGN_SPEC_JSON_SCHEMA,
    schema: designSpecSchema,
    maxTokens: ANALYSIS_MAX_TOKENS,
    validate: designSpecProblems,
    onUsage: llm.onUsage,
  })
  if (answer.ok) {
    return {
      ok: true,
      source,
      spec: normalizeDesignSpec({ ...answer.value, source: source.id }),
    }
  }
  // A spec that failed only the soft checks may still be good enough.
  if (answer.reason === 'invalid' && answer.partial) {
    const spec = normalizeDesignSpec({ ...answer.partial, source: source.id })
    if (spec.sections.length > 0 && spec.palette.length >= 2) {
      return { ok: true, source, spec }
    }
  }
  return { ok: false, source, problems: answer.problems }
}

/** Analyzes every analyzable reference, a few at a time; `onDone` fires as
 * each one finishes (progress events). Results keep the sources' order. */
export async function analyzeReferences(input: {
  llm: FidelityLlm
  sources: ReferenceSource[]
  focus: string
  onStart?: (source: ReferenceSource) => void
  onDone?: (outcome: AnalysisOutcome) => void
}): Promise<AnalysisOutcome[]> {
  const targets = input.sources.filter(isAnalyzable)
  return runLimited(
    targets.map((source) => async () => {
      input.onStart?.(source)
      let outcome: AnalysisOutcome
      try {
        outcome = await analyzeReference({
          llm: input.llm,
          source,
          focus: input.focus,
        })
      } catch {
        outcome = {
          ok: false,
          source,
          problems: ['Falha inesperada na análise'],
        }
      }
      input.onDone?.(outcome)
      return outcome
    }),
    ANALYSIS_CONCURRENCY,
  )
}
