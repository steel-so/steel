import { UNTRUSTED_CONTENT_POLICY } from '@/src/lib/ai/guardrails/injection'
import { SITE_ICON_NAMES } from '@/src/lib/canvas-site/icons'
import {
  type NodeSpec,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { structuredCall } from '@/src/lib/site-ai/run'
import {
  buildSection,
  CONTACT_ANCHOR,
  type SectionContext,
} from '@/src/lib/site-ai/sections'
import { INSPIRATION_RULES } from '@/src/lib/site-inspiration/read'
import { validateSiteDocument } from '@/src/lib/sites/document'
import { type BlueprintCompileContext, blueprintToNodeSpec } from './compile'
import {
  type DesignSection,
  type DesignSpec,
  normalizeHex,
} from './design-spec'
import type { FidelityLlm } from './llm'
import { DATA_SECTIONS, type PlannedSection } from './plan'
import {
  blocksPrompt,
  MAX_SECTION_BLOCKS_CHARS,
  type ReferenceSource,
  stripsFor,
} from './references'
import {
  blueprintProblems,
  isBox,
  SECTION_BLUEPRINT_JSON_SCHEMA,
  SECTION_BLUEPRINT_SCHEMA,
  type SectionBlueprint,
} from './section-blueprint'

/**
 * One blueprint per section: the model sees the reference's strips that
 * cover the section, the DOM blocks of that range and the design tokens of
 * the reference, and draws the section as a `SectionBlueprint` with copy
 * written for the company. The answer is compiled and validated by the
 * site catalog; a section that cannot be drawn (provider failure, invalid
 * answer, timeout) falls back to the equivalent ready section of the
 * generator, so a failing section never takes the generation down.
 */

const MAX_NODES_HINT = 90
const DATA_SECTION_SET = new Set<string>(DATA_SECTIONS)

export const BLUEPRINT_MAX_TOKENS = 10_000
/** One section may take this long (all repair attempts included). */
export const SECTION_TIMEOUT_MS = 240_000

export type SectionOrigin = 'blueprint' | 'ready'

export interface BuiltSection {
  spec: NodeSpec
  origin: SectionOrigin
  /** pt-BR note when the section fell back to a ready one. */
  warning: string | null
}

export interface SectionReference {
  source: ReferenceSource
  spec: DesignSpec
  /** Section of the reference the planned section follows, if any. */
  section: DesignSection | null
}

export function buildBlueprintSystem(): string {
  return [
    'Você é um designer front-end que reproduz o LAYOUT de uma seção de referência com precisão e escreve o conteúdo para outra empresa. Devolva só o JSON do SectionBlueprint (uma árvore: seção > caixas > elementos).',
    'Fidelidade visual: reproduza a estrutura (quantas colunas, o que fica em cada coluna, alinhamento), a hierarquia (tamanhos relativos de título, texto e botões), os espaçamentos (padding vertical da seção, gaps), as cores EXATAS da DesignSpec (use os #rrggbb dela, nunca aproximações), a tipografia (tamanhos em px de desktop, pesos, caixa alta), o formato dos botões (raio, preenchimento) e dos cartões (raio, sombra, borda), e a proporção das imagens. Meça pelas imagens e pelos blocos do DOM quando houver.',
    'Elementos (cada um vira um elemento real do construtor):',
    '- section: a faixa inteira. bg/gradient = fundo; color = cor do texto sobre ele; padY/padX = padding em px; fullWidth=true só quando o fundo e o conteúdo vão de ponta a ponta; maxWidth = largura do conteúdo (ex. 1200); contentAlign: center centraliza as caixas filhas, stretch as estica; minHeight = altura mínima em px.',
    '- box: caixa de layout. layout "column" (empilha), "row" (linha que quebra; use para grupos de botões e pequenos conjuntos) ou "grid" (colunas iguais com `columns` ou trilhas com `columnsTemplate`, ex. "1fr 1fr" ou "5fr 7fr"; columnsMobile 1). Use grid para QUALQUER divisão em colunas (texto + imagem, cartões lado a lado). align = alinhamento no eixo cruzado (em column, center centraliza o conteúdo horizontalmente); textAlign = alinhamento do texto filho; maxWidth limita a largura (ex. 720 para um bloco de título centralizado).',
    '- box com card=true: visual de cartão (bg, radius, shadow, borderWidth/borderColor, padY/padX); card=false para caixas só de layout.',
    '- heading (h1 só na primeira seção da página; h2 nas demais), text (preset lead/body/small/overline; parágrafos separados por linha em branco), button (variant primary/secondary/outline/link; bg/textColor/borderColor/radius quando o botão da referência tiver cor própria), image, icon, list, divider, spacer, form.',
    `- icon.name: um de ${SITE_ICON_NAMES.join(', ')}.`,
    '- image: as imagens da referência NUNCA são copiadas; descreva em `alt` (pt-BR) o que a foto deve mostrar para ESTA empresa. source "stock" usa uma foto neutra do catálogo na proporção mais próxima; "blank" faz um bloco liso (use para logos, ícones grandes, capturas de produto e mockups, com bg claro). ratio = proporção medida na referência; widthPx quando a imagem não preenche a coluna; circle para avatares redondos.',
    '- form: o formulário de contato do CRM; só na seção de contato (obrigatório nela, um só), nunca nas outras.',
    'Responsivo: informe tamanhos de desktop; os valores de tablet/mobile são derivados, mas use columnsMobile, padYMobile, padXMobile, gapMobile e sizeMobilePx quando a referência mudar no celular. Valores null = padrão do tema.',
    'Escreva em português do Brasil, copy específica e original para a empresa do briefing, no tom pedido. Nunca copie textos, slogans, nomes de marca, logos, fotos, preços ou dados da referência. Não invente números, depoimentos, clientes, prêmios, endereços, telefones ou preços: onde faltar dado real, escreva "Sob consulta" ou use texto de benefício sem número. Sem emojis, markdown ou HTML. Respeite a quantidade de itens da referência (3 cartões = 3 cartões).',
    `Use no máximo ${MAX_NODES_HINT} elementos e no máximo 3 níveis de caixas dentro da seção.`,
    ...INSPIRATION_RULES.slice(0, 1),
    UNTRUSTED_CONTENT_POLICY,
  ].join('\n')
}

/** Design tokens of a reference as compact JSON (sections left out). */
export function describeTokens(spec: DesignSpec): string {
  const { sections: _sections, source: _source, ...tokens } = spec
  return JSON.stringify(tokens)
}

export interface SectionRequest {
  planned: PlannedSection
  pageTitle: string
  /** Position of the section in its page (0-based) and the page's total. */
  index: number
  total: number
  /** Design tokens come from here (the primary reference). */
  primary: DesignSpec
  reference: SectionReference | null
  brief: string[]
  focus: string
  companyName: string
  ctaLabel: string
}

export function buildBlueprintMessage(request: SectionRequest): string[] {
  const { planned, reference } = request
  const lines = [
    'Briefing:',
    ...request.brief,
    '',
    `Página: ${request.pageTitle} — seção ${request.index + 1} de ${request.total}: "${planned.name}".`,
    `Conteúdo desta seção (para ${request.companyName}): ${planned.purpose}`,
    `Botão principal do site: "${request.ctaLabel}" (todos os botões levam ao contato).`,
    ...(planned.equivalent === 'contact'
      ? [
          'Esta é a seção de CONTATO: inclua exatamente um elemento form, com o convite ao lado ou acima.',
        ]
      : []),
    ...(request.focus
      ? [`O que o cliente quer aproveitar: ${request.focus}`]
      : []),
    '',
    `Tokens de design (DesignSpec da referência principal ${request.primary.source}):`,
    describeTokens(request.primary),
  ]
  if (reference?.section) {
    lines.push(
      '',
      `Seção da referência ${reference.source.label} que esta deve imitar (DesignSpec):`,
      JSON.stringify(reference.section),
    )
    if (reference.source.id !== request.primary.source) {
      lines.push(
        `Atenção: esta referência tem os próprios tokens: ${describeTokens(reference.spec)}`,
      )
    }
    if (reference.source.capture) {
      lines.push(
        ...blocksPrompt(
          reference.source.capture,
          reference.section,
          MAX_SECTION_BLOCKS_CHARS,
        ),
      )
    }
  } else {
    lines.push(
      '',
      'Não há seção de referência para esta: componha no mesmo estilo geral (cores, tipografia, botões, cartões, espaçamento) dos tokens.',
    )
  }
  return lines
}

/** Pictures that show the section: the capture's strips for its range, or
 * the user's picture. */
export function sectionImages(request: SectionRequest): string[] {
  const reference = request.reference
  if (!reference) return []
  const capture = reference.source.capture
  if (capture) return stripsFor(capture, reference.section ?? {})
  return reference.source.images.slice(0, 1)
}

/** `hex → hex` replacement over the whole blueprint (brand color wins
 * over the reference's primary). */
export function remapBlueprintColors(
  blueprint: SectionBlueprint,
  map: Record<string, string>,
): SectionBlueprint {
  if (Object.keys(map).length === 0) return blueprint
  const text = JSON.stringify(blueprint).replace(
    /"(#[0-9a-fA-F]{6})"/g,
    (match, hex: string) => {
      const target = map[hex.toLowerCase()]
      return target ? `"${target}"` : match
    },
  )
  return JSON.parse(text) as SectionBlueprint
}

/** Colors to swap: the reference's primary becomes the customer's brand
 * color (when they gave one). */
export function brandColorMap(
  primary: DesignSpec,
  brandColor: string | null | undefined,
): Record<string, string> {
  const brand = normalizeHex(brandColor)
  const reference = normalizeHex(
    primary.palette.find((item) => item.role === 'primary')?.hex,
  )
  return brand && reference && brand !== reference ? { [reference]: brand } : {}
}

function hasForm(blueprint: SectionBlueprint): boolean {
  const visit = (node: SectionBlueprint['children'][number]): boolean =>
    node.type === 'form' || (isBox(node) && node.children.some(visit))
  return blueprint.children.some(visit)
}

/** Compiles and validates a blueprint with the site catalog. */
export function compileValidated(
  blueprint: SectionBlueprint,
  ctx: BlueprintCompileContext,
): { ok: true; spec: NodeSpec } | { ok: false; problems: string[] } {
  const spec = blueprintToNodeSpec(blueprint, ctx)
  const checked = validateSiteDocument(toDocument([spec]))
  return checked.ok
    ? { ok: true, spec }
    : { ok: false, problems: checked.error.slice(0, 4) }
}

export type BlueprintResult =
  | { ok: true; spec: NodeSpec; blueprint: SectionBlueprint }
  | { ok: false; problems: string[] }

/** Draws one section. Never throws. */
export async function generateSectionBlueprint(input: {
  llm: FidelityLlm
  request: SectionRequest
  ctx: BlueprintCompileContext
  brandColor?: string | null
  timeoutMs?: number
}): Promise<BlueprintResult> {
  const { llm, request } = input
  const wantsForm = request.planned.equivalent === 'contact'
  const call = structuredCall({
    provider: llm.provider,
    model: llm.model,
    system: buildBlueprintSystem(),
    message: buildBlueprintMessage(request).join('\n'),
    images: sectionImages(request),
    schemaName: 'section_blueprint',
    jsonSchema: SECTION_BLUEPRINT_JSON_SCHEMA,
    schema: SECTION_BLUEPRINT_SCHEMA,
    maxTokens: BLUEPRINT_MAX_TOKENS,
    validate: (value) => {
      const problems = blueprintProblems(value)
      if (wantsForm && !hasForm(value)) {
        problems.push('A seção de contato precisa de um elemento form')
      }
      if (!wantsForm && hasForm(value)) {
        problems.push('Só a seção de contato leva o elemento form: remova-o')
      }
      return problems
    },
    onUsage: llm.onUsage,
  })
  // A timed-out call keeps running (and is still metered); its late result
  // is ignored.
  call.catch(() => undefined)
  const timeoutMs = input.timeoutMs ?? SECTION_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  let answer: Awaited<typeof call> | 'timeout'
  try {
    answer = await Promise.race([call, timeout])
  } catch {
    return { ok: false, problems: ['Falha inesperada ao desenhar a seção'] }
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (answer === 'timeout') {
    return {
      ok: false,
      problems: ['A IA demorou demais para desenhar a seção'],
    }
  }
  if (!answer.ok) return { ok: false, problems: answer.problems }
  const blueprint = remapBlueprintColors(
    answer.value,
    brandColorMap(request.primary, input.brandColor),
  )
  const compiled = compileValidated(blueprint, input.ctx)
  if (!compiled.ok) return compiled
  return { ok: true, spec: compiled.spec, blueprint }
}

/** A planned section as a node spec: data sections (products,
 * testimonials, countdown) are the ready ones; the rest are drawn, with
 * the equivalent ready section as the fallback. */
export async function buildFidelitySection(input: {
  llm: FidelityLlm
  request: SectionRequest
  sectionCtx: SectionContext
  brandColor?: string | null
  /** Skips the model (budget spent): straight to the ready section. */
  skipDrawing?: boolean
  timeoutMs?: number
  draw?: typeof generateSectionBlueprint
}): Promise<BuiltSection> {
  const { planned } = input.request
  const ready = (warning: string | null): BuiltSection => ({
    spec: buildSection(planned.equivalent, input.sectionCtx),
    origin: 'ready',
    warning,
  })
  if (DATA_SECTION_SET.has(planned.equivalent)) return ready(null)
  if (input.skipDrawing) {
    return ready(
      `A seção "${planned.name}" da página ${input.request.pageTitle} usou o modelo pronto (limite de tempo ou de cota de IA).`,
    )
  }
  const draw = input.draw ?? generateSectionBlueprint
  const result = await draw({
    llm: input.llm,
    request: input.request,
    ctx: {
      contactLink: input.sectionCtx.contactLink,
      ...(planned.equivalent === 'contact'
        ? { sectionAnchor: CONTACT_ANCHOR }
        : {}),
    },
    brandColor: input.brandColor,
    timeoutMs: input.timeoutMs,
  })
  if (result.ok) {
    return { spec: result.spec, origin: 'blueprint', warning: null }
  }
  return ready(
    `A seção "${planned.name}" da página ${input.request.pageTitle} não pôde ser desenhada como a referência e usou o modelo pronto.`,
  )
}
