import { z } from 'zod'
import { UNTRUSTED_CONTENT_POLICY } from '@/src/lib/ai/guardrails/injection'
import { structuredCall } from '@/src/lib/site-ai/run'
import { strictJsonSchema } from '../blueprint/json-schema'
import type { FidelityLlm } from '../blueprint/llm'

/**
 * Visual comparison of ONE section: a vision model sees the strips of the
 * reference and the strips of the rendered draft and answers a similarity
 * score (0-100) plus the concrete differences, each with the fix to apply.
 * The answer feeds the redraw of the section's blueprint (ADR 0072).
 */

export const COMPARE_MAX_TOKENS = 3_000
export const COMPARE_TIMEOUT_MS = 180_000
export const MAX_DIFFERENCES = 8

export const DIFFERENCE_ASPECTS = [
  'color',
  'spacing',
  'alignment',
  'size',
  'columns',
  'order',
  'missing',
  'extra',
  'typography',
  'image',
  'shape',
  'other',
] as const
export type DifferenceAspect = (typeof DIFFERENCE_ASPECTS)[number]

export const DIFFERENCE_SEVERITIES = ['low', 'medium', 'high'] as const
export type DifferenceSeverity = (typeof DIFFERENCE_SEVERITIES)[number]

export const ASPECT_LABELS: Record<DifferenceAspect, string> = {
  color: 'cores',
  spacing: 'espaçamento',
  alignment: 'alinhamento',
  size: 'tamanhos',
  columns: 'colunas',
  order: 'ordem',
  missing: 'elemento ausente',
  extra: 'elemento a mais',
  typography: 'tipografia',
  image: 'imagem',
  shape: 'forma (raio, sombra, borda)',
  other: 'outro',
}

const differenceSchema = z.object({
  aspect: z.enum(DIFFERENCE_ASPECTS),
  severity: z.enum(DIFFERENCE_SEVERITIES),
  /** What differs, in pt-BR (reference versus draft). */
  description: z.string(),
  /** What to change in the draft, in pt-BR, with measures when possible. */
  fix: z.string(),
})

export const comparisonSchema = z.object({
  /** 0 (nothing alike) to 100 (indistinguishable layout and style). */
  score: z.number(),
  differences: z.array(differenceSchema),
})
export type SectionComparison = z.infer<typeof comparisonSchema>
export type SectionDifference = z.infer<typeof differenceSchema>

export const COMPARISON_JSON_SCHEMA = strictJsonSchema(comparisonSchema)

export function buildCompareSystem(): string {
  return [
    'Você é um revisor de qualidade visual que compara o RASCUNHO de uma seção de site com a REFERÊNCIA que ele deve imitar. Devolva só o JSON pedido.',
    'Compare o design, não o conteúdo: o rascunho é de outra empresa, então textos, nomes, logos e o assunto das fotos DEVEM ser diferentes. Avalie estrutura (quantidade de colunas, o que fica em cada uma, ordem dos elementos), hierarquia e tamanhos relativos de título/texto/botões, alinhamento, espaçamento vertical e entre itens, cores de fundo/texto/botões (a paleta do rascunho pode trocar a cor da marca pela do cliente: só reclame de cor quando fundo claro/escuro, contraste ou o papel da cor divergirem), tipografia (peso, tamanho, caixa alta), formato de botões e cartões (raio, sombra, borda) e proporção das imagens.',
    'Nota de 0 a 100: 90+ = praticamente igual em estrutura e estilo; 75-89 = mesma estrutura com diferenças visíveis de medida ou cor; 50-74 = estrutura parecida mas com problemas claros; abaixo de 50 = estrutura ou estilo bem diferentes. Seja rigoroso e consistente: a mesma diferença deve render a mesma nota.',
    `Liste no máximo ${MAX_DIFFERENCES} diferenças, da mais grave para a menos grave. Cada uma traz o aspecto, a gravidade (high = muda a estrutura ou a leitura; medium = visível; low = detalhe), a descrição (referência versus rascunho) e a correção objetiva em pt-BR, com medidas aproximadas em px ou cores #rrggbb quando der para estimar (ex.: "aumentar o título de ~32px para ~56px"; "passar de 2 para 3 colunas"). Se a nota for 90 ou mais, a lista pode ser vazia.`,
    'As primeiras imagens são a REFERÊNCIA e as seguintes são o RASCUNHO (a mensagem diz quantas de cada). As faixas cobrem um pouco mais do que a seção: olhe só a faixa vertical indicada na mensagem.',
    UNTRUSTED_CONTENT_POLICY,
  ].join('\n')
}

export interface CompareInput {
  llm: FidelityLlm
  sectionName: string
  /** What the section says for the company (context only). */
  purpose: string
  referenceImages: string[]
  /** Where the section is inside the reference's pictures. */
  referenceNote: string
  draftImages: string[]
  draftNote: string
  timeoutMs?: number
}

export type CompareResult =
  | { ok: true; comparison: SectionComparison }
  | { ok: false; problems: string[] }

export function buildCompareMessage(input: CompareInput): string {
  return [
    `Seção: "${input.sectionName}".`,
    `Conteúdo pretendido (para a empresa do rascunho): ${input.purpose}`,
    '',
    `REFERÊNCIA: as primeiras ${input.referenceImages.length} imagem(ns). ${input.referenceNote}`,
    `RASCUNHO: as ${input.draftImages.length} imagem(ns) seguintes. ${input.draftNote}`,
    '',
    'Compare e devolva a nota e as diferenças.',
  ].join('\n')
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Compares one section. Never throws. */
export async function compareSection(
  input: CompareInput,
): Promise<CompareResult> {
  const { llm } = input
  const call = structuredCall({
    provider: llm.provider,
    model: llm.model,
    system: buildCompareSystem(),
    message: buildCompareMessage(input),
    images: [...input.referenceImages, ...input.draftImages],
    schemaName: 'section_comparison',
    jsonSchema: COMPARISON_JSON_SCHEMA,
    schema: comparisonSchema,
    maxTokens: COMPARE_MAX_TOKENS,
    validate: (value) =>
      Number.isFinite(value.score) && value.score >= 0 && value.score <= 100
        ? []
        : ['A nota deve ficar entre 0 e 100'],
    onUsage: llm.onUsage,
    maxAttempts: 2,
  })
  // A timed-out call keeps running (and is still metered).
  call.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(
      () => resolve('timeout'),
      input.timeoutMs ?? COMPARE_TIMEOUT_MS,
    )
  })
  let answer: Awaited<typeof call> | 'timeout'
  try {
    answer = await Promise.race([call, timeout])
  } catch {
    return { ok: false, problems: ['Falha inesperada ao comparar a seção'] }
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (answer === 'timeout') {
    return { ok: false, problems: ['A IA demorou demais para comparar'] }
  }
  if (!answer.ok) return { ok: false, problems: answer.problems }
  return {
    ok: true,
    comparison: {
      score: clampScore(answer.value.score),
      differences: answer.value.differences.slice(0, MAX_DIFFERENCES),
    },
  }
}

/** The differences as instruction lines for the redraw (pt-BR). */
export function differencesToInstructions(
  differences: SectionDifference[],
): string[] {
  return differences.map(
    (item, index) =>
      `${index + 1}. [${item.severity === 'high' ? 'grave' : item.severity === 'medium' ? 'média' : 'leve'}; ${ASPECT_LABELS[item.aspect]}] ${item.description} — Corrigir: ${item.fix}`,
  )
}
