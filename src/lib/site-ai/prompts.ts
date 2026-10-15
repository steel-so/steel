import { z } from 'zod'
import { SITE_ICON_NAMES } from '@/src/lib/canvas-site/icons'
import { SITE_FONTS } from '@/src/lib/canvas-site/theme'
import {
  type GenerateSiteDTO,
  SITE_AI_GOAL_LABELS,
  SITE_AI_LENGTH_LABELS,
  SITE_AI_TONE_LABELS,
  type SiteAiLength,
  type SiteAiTone,
} from '@/src/schemas/site-ai.schema'
import type { SitePageKind } from './plan'
import {
  SITE_AI_SECTION_HINTS,
  SITE_AI_SECTIONS,
  type SiteAiProductData,
  type SiteAiSection,
  type SiteAiTestimonialData,
} from './sections'
import type { TextSlot } from './slots'

/**
 * Prompts and answer formats of the AI site generator. Everything the
 * model reads is pt-BR; every answer is a strict JSON object (structured
 * outputs) that `structuredCall` parses, checks and repairs.
 */

const STRING = { type: 'string' }

const RULES = [
  'Escreva em português do Brasil, com a ortografia e a pontuação corretas.',
  'Copy clara, específica do negócio e orientada ao benefício para o cliente; nada genérico que serviria para qualquer empresa.',
  'Nunca invente números, preços, prazos, prêmios, certificações, clientes, depoimentos, endereços, telefones ou e-mails. Use só os dados fornecidos.',
  'Onde o campo pedir preço e não houver produto do CRM com preço, escreva "Sob consulta".',
  'Sem emojis, sem markdown, sem HTML e sem aspas em volta dos textos.',
]

/** The brief as context lines (shared by the plan and the page calls). */
export function briefLines(
  dto: Pick<
    GenerateSiteDTO,
    'name' | 'business' | 'audience' | 'goal' | 'tone' | 'extra'
  >,
  data: {
    products: SiteAiProductData[]
    testimonials: SiteAiTestimonialData[]
    eventDate: string | null
  },
): string[] {
  const lines = [`Empresa: ${dto.name}`, `O que a empresa faz: ${dto.business}`]
  if (dto.audience) lines.push(`Público: ${dto.audience}`)
  lines.push(
    `Objetivo do site: ${SITE_AI_GOAL_LABELS[dto.goal]}`,
    `Tom de voz: ${SITE_AI_TONE_LABELS[dto.tone]}`,
  )
  if (data.eventDate) lines.push(`Data do evento: ${data.eventDate}`)
  if (data.products.length > 0) {
    lines.push('Produtos do CRM (nome, preço e descrição reais):')
    for (const product of data.products) {
      lines.push(
        `- ${product.name} — ${product.price}${product.description ? ` — ${product.description.slice(0, 200)}` : ''}`,
      )
    }
  }
  if (data.testimonials.length > 0) {
    lines.push(
      `Há ${data.testimonials.length} depoimento(s) real(is) de clientes disponível(is).`,
    )
  }
  if (dto.extra) lines.push(`Observações do cliente: ${dto.extra}`)
  return lines
}

// ─── plan ─────────────────────────────────────────────────────────────────

export function buildPlanSystem(kinds: SitePageKind[]): string {
  return [
    'Você é um web designer e estrategista de conteúdo brasileiro que planeja sites de empresas.',
    'Planeje o site a partir do briefing e devolva só o JSON pedido.',
    '- siteName: nome do site (normalmente o nome da empresa).',
    '- tagline: frase de até 120 caracteres com a proposta de valor.',
    '- ctaLabel: texto do botão principal, até 24 caracteres, coerente com o objetivo.',
    '- style: "agency" (criativo, arejado, cartões coloridos), "b2b" (corporativo, sóbrio, alinhado à esquerda) ou "saas" (produto digital, gradiente, botões arredondados).',
    '- palette: cores #RRGGBB. primary = cor da marca; secondary e accent combinam com ela; dark = um tom bem escuro para fundos e textos.',
    `- fonts: heading e body entre ${SITE_FONTS.map((font) => `"${font.id}" (${font.label})`).join(', ')}.`,
    `- pages: exatamente uma entrada para cada página destas: ${kinds.join(', ')}. title é o nome curto da página no menu (até 24 caracteres). sections é a ordem das seções, de cima para baixo, escolhidas entre:`,
    ...SITE_AI_SECTIONS.map(
      (type) => `  - ${type}: ${SITE_AI_SECTION_HINTS[type]}`,
    ),
    'Regras das seções: a página home começa com hero; as outras começam com intro; contact tem o formulário (fica na página contact, ou no fim da home se não houver página de contato); products e testimonials só quando o briefing tiver esses dados; countdown só para evento com data; de 3 a 6 seções por página.',
    ...RULES,
  ].join('\n')
}

// ─── slot answers ────────────────────────────────────────────────────────

const FIELD_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text'],
  properties: { id: STRING, text: STRING },
}

const FieldsSchema = z.array(z.object({ id: z.string(), text: z.string() }))

export const PageCopyOutputSchema = z.object({
  seoTitle: z.string(),
  seoDescription: z.string(),
  fields: FieldsSchema,
})
export type PageCopyOutput = z.infer<typeof PageCopyOutputSchema>

export const PAGE_COPY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['seoTitle', 'seoDescription', 'fields'],
  properties: {
    seoTitle: STRING,
    seoDescription: STRING,
    fields: { type: 'array', items: FIELD_ITEM },
  },
}

export const FieldsOutputSchema = z.object({ fields: FieldsSchema })
export type FieldsOutput = z.infer<typeof FieldsOutputSchema>

export const FIELDS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: { fields: { type: 'array', items: FIELD_ITEM } },
}

/** Slot ids the answer left out (`[]` = complete). */
export function missingFields(
  slots: TextSlot[],
  fields: Array<{ id: string; text: string }>,
): string[] {
  const answered = new Set(
    fields.filter((item) => item.text.trim()).map((item) => item.id),
  )
  return slots.map((slot) => slot.id).filter((id) => !answered.has(id))
}

/** "Faltaram campos" problem for the repair turn, if any. */
export function checkFields(
  slots: TextSlot[],
  fields: Array<{ id: string; text: string }>,
): string[] {
  const missing = missingFields(slots, fields)
  return missing.length === 0
    ? []
    : [`Faltaram estes campos (devolva todos): ${missing.join(', ')}`]
}

/** Slots grouped by section, as the model reads them. */
export function describeSlots(slots: TextSlot[]): string {
  const lines: string[] = []
  let section: string | null = null
  for (const slot of slots) {
    if (slot.section !== section) {
      section = slot.section
      lines.push(`## Seção: ${section || 'Página'}`)
    }
    const current = slot.current.replace(/\s+/g, ' ').slice(0, 240)
    lines.push(
      `- ${slot.id} [${slot.role}, máx. ${slot.max} caracteres${slot.multiline ? ', pode ter parágrafos' : ''}]: ${current ? `"${current}"` : '(vazio)'}`,
    )
  }
  return lines.join('\n')
}

const ICONS_LINE = `Campos "Ícone" recebem só um destes nomes, exatamente assim: ${SITE_ICON_NAMES.join(', ')}.`

export function buildPageCopySystem(input: {
  brief: string[]
  pageTitle: string
  testimonials: SiteAiTestimonialData[]
}): string {
  return [
    `Você é o redator do site descrito abaixo. Escreva os textos da página "${input.pageTitle}".`,
    'Briefing:',
    ...input.brief,
    '',
    'Cada campo tem um id, um papel, um limite de caracteres e o texto de exemplo do modelo de seção. O exemplo só mostra a função e o tamanho do texto: reescreva tudo para este negócio.',
    ICONS_LINE,
    'Textos alternativos de imagem descrevem a foto ideal para aquele lugar, em uma frase.',
    'Devolva JSON com seoTitle (até 60 caracteres, com o nome da empresa), seoDescription (até 155 caracteres) e fields com TODOS os ids da lista, cada um com o texto final.',
    ...(input.testimonials.length > 0
      ? [
          'Depoimentos reais (cite só estes, nunca invente outros):',
          ...input.testimonials.map(
            (item) =>
              `- "${item.quote}" — ${item.name}${item.role ? `, ${item.role}` : ''}`,
          ),
        ]
      : []),
    ...RULES,
  ].join('\n')
}

// ─── editor: section ─────────────────────────────────────────────────────

/** Sections the editor can generate (data sections stay in the wizard). */
export const EDITOR_SECTIONS = [
  'hero',
  'intro',
  'services',
  'features',
  'about',
  'steps',
  'faq',
  'pricing',
  'cta',
] as const satisfies readonly SiteAiSection[]
export type EditorSection = (typeof EDITOR_SECTIONS)[number]

export const SectionChoiceOutputSchema = z.object({
  reply: z.string(),
  section: z.enum(EDITOR_SECTIONS),
})
export type SectionChoiceOutput = z.infer<typeof SectionChoiceOutputSchema>

export const SECTION_CHOICE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'section'],
  properties: {
    reply: STRING,
    section: { type: 'string', enum: [...EDITOR_SECTIONS] },
  },
}

export function buildSectionChoiceSystem(context: {
  siteName: string
  pageTitle: string
  headings: string[]
}): string {
  return [
    'Você ajuda a montar páginas de site. Escolha o modelo de seção que melhor atende ao pedido do usuário.',
    `Site: ${context.siteName}. Página: ${context.pageTitle || 'sem título'}.`,
    ...(context.headings.length > 0
      ? [`Títulos que já estão na página: ${context.headings.join(' | ')}`]
      : []),
    'Modelos:',
    ...EDITOR_SECTIONS.map(
      (type) => `- ${type}: ${SITE_AI_SECTION_HINTS[type]}`,
    ),
    'Devolva JSON com section (o modelo) e reply (uma frase curta, em português, dizendo o que a seção vai ter).',
  ].join('\n')
}

export function buildSectionCopySystem(context: {
  siteName: string
  pageTitle: string
  headings: string[]
  prompt: string
}): string {
  return [
    `Você é o redator do site ${context.siteName}. Escreva os textos de uma nova seção da página "${context.pageTitle || 'sem título'}".`,
    `Pedido do usuário: ${context.prompt}`,
    ...(context.headings.length > 0
      ? [
          `Títulos que já estão na página (mantenha coerência e não repita): ${context.headings.join(' | ')}`,
        ]
      : []),
    'Cada campo tem um id, um papel, um limite de caracteres e o texto de exemplo do modelo. O exemplo só mostra a função e o tamanho: reescreva tudo para este pedido.',
    ICONS_LINE,
    'Devolva JSON com fields contendo TODOS os ids da lista.',
    ...RULES,
  ].join('\n')
}

// ─── editor: rewrite ─────────────────────────────────────────────────────

const LENGTH_RULE: Record<SiteAiLength, string> = {
  shorter:
    'Deixe cada texto mais curto e direto (cerca de metade do tamanho, quando der), sem perder a mensagem.',
  same: 'Mantenha o tamanho de cada texto parecido com o atual.',
  longer:
    'Deixe os parágrafos um pouco mais completos e concretos, respeitando o limite de cada campo; títulos e botões continuam curtos.',
}

export function buildRewriteSystem(input: {
  siteName: string
  tone: SiteAiTone
  length: SiteAiLength
  instructions: string
}): string {
  return [
    `Você é o redator do site ${input.siteName}. Reescreva os textos da página no tom "${SITE_AI_TONE_LABELS[input.tone]}" (${SITE_AI_LENGTH_LABELS[input.length].toLowerCase()}).`,
    LENGTH_RULE[input.length],
    'Mantenha o sentido, os fatos, os nomes, os preços e os números de cada texto. Não junte nem divida campos.',
    ...(input.instructions
      ? [`Instruções do usuário: ${input.instructions}`]
      : []),
    'Devolva JSON com fields contendo TODOS os ids da lista, cada um com o texto reescrito.',
    ...RULES,
  ].join('\n')
}

// ─── editor: images ──────────────────────────────────────────────────────

export const ImagesOutputSchema = z.object({
  images: z.array(
    z.object({
      id: z.string(),
      candidate: z.string(),
      alt: z.string(),
      idea: z.string(),
    }),
  ),
})
export type ImagesOutput = z.infer<typeof ImagesOutputSchema>

export const IMAGES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['images'],
  properties: {
    images: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'candidate', 'alt', 'idea'],
        properties: {
          id: STRING,
          candidate: STRING,
          alt: STRING,
          idea: STRING,
        },
      },
    },
  },
}

export function buildImagesSystem(siteName: string): string {
  return [
    `Você é o diretor de arte do site ${siteName}. Para cada imagem da página, escolha a melhor opção da lista de imagens disponíveis.`,
    'Use só ids da lista de imagens disponíveis (candidate). Para manter a imagem atual, use candidate vazio.',
    'Prefira imagens da biblioteca do workspace quando a descrição combinar com o contexto; use as imagens de exemplo só como provisórias.',
    'alt: texto alternativo da imagem escolhida, em uma frase objetiva (até 160 caracteres), descrevendo o que aparece nela.',
    'idea: a foto ideal para aquele lugar, para a empresa fotografar ou licenciar depois (até 160 caracteres).',
    'Devolva JSON com images contendo uma entrada para CADA imagem da lista de imagens da página.',
    'Escreva em português do Brasil, sem emojis.',
  ].join('\n')
}
