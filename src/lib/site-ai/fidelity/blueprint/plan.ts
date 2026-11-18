import { z } from 'zod'
import { SITE_AI_PAGE_SLUGS, type SitePageKind } from '@/src/lib/site-ai/plan'
import { structuredCall } from '@/src/lib/site-ai/run'
import {
  SITE_AI_SECTION_HINTS,
  SITE_AI_SECTIONS,
  type SiteAiSection,
} from '@/src/lib/site-ai/sections'
import { INSPIRATION_RULES } from '@/src/lib/site-inspiration/read'
import { SITE_AI_PAGE_LABELS } from '@/src/schemas/site-ai.schema'
import type { DesignSpec } from './design-spec'
import { strictJsonSchema } from './json-schema'
import type { FidelityLlm } from './llm'

/**
 * Page plan of a reference-faithful generation: for every page, the
 * sections in order, each pointing at the reference section whose layout
 * it should follow (`referenceId` + `referenceSection`) and carrying a
 * pt-BR content brief (`purpose`). `equivalent` is the ready section used
 * when the section carries CRM data (products, testimonials, countdown)
 * or when its blueprint fails.
 */

export const FIDELITY_PLAN_MAX_TOKENS = 6_000
export const MAX_FIDELITY_SECTIONS_PER_PAGE = 9

/** Ready sections that carry workspace data: built as is, never drawn. */
export const DATA_SECTIONS: readonly SiteAiSection[] = [
  'products',
  'testimonials',
  'countdown',
]

const plannedSectionSchema = z.object({
  /** Layer name (pt-BR, short): "Destaque", "Planos"… */
  name: z.string(),
  /** What this section says for the company, in pt-BR (content brief). */
  purpose: z.string(),
  equivalent: z.enum(SITE_AI_SECTIONS),
  /** Reference whose layout this section follows (`ref1`…), or null. */
  referenceId: z.string().nullable(),
  /** Index (from 0) of the section inside that reference's `sections`. */
  referenceSection: z.number().int().nullable(),
})
export type PlannedSection = z.infer<typeof plannedSectionSchema>

export const fidelityPlanSchema = z.object({
  siteName: z.string(),
  tagline: z.string(),
  ctaLabel: z.string(),
  pages: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      seoTitle: z.string(),
      seoDescription: z.string(),
      sections: z.array(plannedSectionSchema),
    }),
  ),
})
export type FidelityPlanOutput = z.infer<typeof fidelityPlanSchema>

export const FIDELITY_PLAN_JSON_SCHEMA = strictJsonSchema(fidelityPlanSchema)

export interface FidelityPlanPage {
  kind: SitePageKind
  title: string
  slug: string
  seo: { title: string; description: string }
  sections: PlannedSection[]
}

export interface FidelityPlan {
  siteName: string
  tagline: string
  ctaLabel: string
  pages: FidelityPlanPage[]
}

export interface FidelityAvailability {
  products: boolean
  testimonials: boolean
  event: boolean
}

const DEFAULT_SECTIONS: Record<SitePageKind, SiteAiSection[]> = {
  home: ['hero', 'services', 'about', 'cta'],
  about: ['intro', 'about', 'features', 'cta'],
  services: ['intro', 'services', 'steps', 'cta'],
  products: ['intro', 'products', 'cta'],
  pricing: ['intro', 'pricing', 'faq', 'cta'],
  faq: ['intro', 'faq', 'cta'],
  contact: ['intro', 'contact'],
}

const SECTION_NAMES: Record<SiteAiSection, string> = {
  hero: 'Destaque',
  intro: 'Abertura',
  services: 'Serviços',
  features: 'Diferenciais',
  about: 'Sobre',
  steps: 'Como funciona',
  faq: 'Perguntas frequentes',
  pricing: 'Planos',
  products: 'Produtos',
  testimonials: 'Depoimentos',
  countdown: 'Contagem regressiva',
  cta: 'Chamada para ação',
  contact: 'Contato',
}

function line(value: string | undefined, max: number, fallback: string) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return text || fallback
}

function plain(equivalent: SiteAiSection): PlannedSection {
  return {
    name: SECTION_NAMES[equivalent],
    purpose: SITE_AI_SECTION_HINTS[equivalent],
    equivalent,
    referenceId: null,
    referenceSection: null,
  }
}

/** The plan the generator follows, from the model's answer (or none):
 * keeps what the brief allows, fills every gap with defaults, and
 * guarantees one contact section, real-data sections only with data, and a
 * hard cap per page. */
export function normalizeFidelityPlan(
  raw: FidelityPlanOutput | null,
  input: {
    kinds: SitePageKind[]
    name: string
    defaultCtaLabel: string
    availability: FidelityAvailability
    /** `equivalent` of each section of every reference, by reference id
     * (validates the plan's pointers and fills the missing ones). */
    referenceEquivalents: Record<string, SiteAiSection[]>
  },
): FidelityPlan {
  const { availability, referenceEquivalents } = input
  const hasContactPage = input.kinds.includes('contact')
  let contactPlaced = false

  const usable = (item: PlannedSection) =>
    (item.equivalent !== 'products' || availability.products) &&
    (item.equivalent !== 'testimonials' || availability.testimonials) &&
    (item.equivalent !== 'countdown' || availability.event)

  /** Pointer checked against the references; a missing one is filled with
   * the first reference section of the same kind. */
  const sanitize = (item: PlannedSection): PlannedSection => {
    const list =
      item.referenceId === null
        ? undefined
        : referenceEquivalents[item.referenceId]
    const valid =
      list !== undefined &&
      item.referenceSection !== null &&
      item.referenceSection >= 0 &&
      item.referenceSection < list.length
    let referenceId = valid ? item.referenceId : null
    let referenceSection = valid ? item.referenceSection : null
    if (!valid) {
      for (const [id, equivalents] of Object.entries(referenceEquivalents)) {
        const index = equivalents.indexOf(item.equivalent)
        if (index !== -1) {
          referenceId = id
          referenceSection = index
          break
        }
      }
    }
    return {
      name: line(item.name, 60, SECTION_NAMES[item.equivalent]),
      purpose: line(item.purpose, 400, SITE_AI_SECTION_HINTS[item.equivalent]),
      equivalent: item.equivalent,
      referenceId,
      referenceSection,
    }
  }

  const pages = input.kinds.map((kind): FidelityPlanPage => {
    const proposed = raw?.pages.find((page) => page.kind === kind)
    const all = (proposed?.sections ?? []).map(sanitize)
    let sections = all
      .filter((item) => item.equivalent !== 'contact')
      .filter(usable)
    if (sections.length === 0) {
      sections = DEFAULT_SECTIONS[kind]
        .filter((type) => type !== 'contact')
        .map((type) => sanitize(plain(type)))
        .filter(usable)
    }
    if (kind === 'products' && availability.products) {
      if (!sections.some((item) => item.equivalent === 'products')) {
        sections.splice(1, 0, sanitize(plain('products')))
      }
    }
    if (kind === 'home' && availability.event) {
      if (!sections.some((item) => item.equivalent === 'countdown')) {
        sections.splice(1, 0, sanitize(plain('countdown')))
      }
    }
    // One form per site: on the contact page when there is one, else at
    // the end of the home page.
    const contactHere =
      kind === 'contact' || (kind === 'home' && !hasContactPage)
    sections = sections.slice(
      0,
      MAX_FIDELITY_SECTIONS_PER_PAGE - (contactHere ? 1 : 0),
    )
    if (contactHere && !contactPlaced) {
      sections.push(
        all.find((item) => item.equivalent === 'contact') ??
          sanitize(plain('contact')),
      )
      contactPlaced = true
    }
    const title = line(proposed?.title, 40, SITE_AI_PAGE_LABELS[kind])
    return {
      kind,
      title,
      slug: SITE_AI_PAGE_SLUGS[kind],
      seo: {
        title: line(proposed?.seoTitle, 70, title),
        description: line(proposed?.seoDescription, 160, ''),
      },
      sections,
    }
  })

  return {
    siteName: line(raw?.siteName, 120, input.name),
    tagline: line(raw?.tagline, 160, input.name),
    ctaLabel: line(raw?.ctaLabel, 30, input.defaultCtaLabel),
    pages,
  }
}

export function buildFidelityPlanSystem(kinds: SitePageKind[]): string {
  return [
    'Você é um web designer e estrategista de conteúdo brasileiro. O cliente quer um site com o layout o mais próximo possível das referências analisadas. Devolva só o JSON do plano.',
    '- siteName: nome do site (normalmente o nome da empresa). tagline: proposta de valor em até 120 caracteres. ctaLabel: botão principal, até 24 caracteres.',
    `- pages: exatamente uma entrada para cada página: ${kinds.map((kind) => `${kind} (${SITE_AI_PAGE_LABELS[kind]})`).join(', ')}. Para cada uma: title (nome curto no menu, até 24 caracteres), seoTitle (até 60), seoDescription (até 155) e sections.`,
    '- sections: a ordem de cima para baixo. Para a página home, siga a ORDEM e a estrutura das seções da referência principal (ref1) o mais fielmente possível — mesmas seções, mesma ordem — trocando só o conteúdo para a empresa do briefing. Páginas internas reaproveitam os mesmos tipos de seção e o mesmo visual das referências.',
    '- Cada seção aponta para a seção da referência cujo layout ela deve seguir: referenceId (ref1, ref2…) e referenceSection (o índice, começando em 0, da seção na lista sections daquela referência). Use null nos dois só quando nenhuma seção da referência serve.',
    '- name: nome curto da camada (pt-BR). purpose: o que a seção diz, para ESTA empresa, em uma ou duas frases (conteúdo, não layout).',
    `- equivalent: a seção pronta mais parecida, entre: ${SITE_AI_SECTIONS.map((type) => `${type} (${SITE_AI_SECTION_HINTS[type]})`).join('; ')}. products, testimonials e countdown só existem quando o briefing tiver esses dados; use "contact" apenas na seção do formulário de contato (uma por site).`,
    `- Até ${MAX_FIDELITY_SECTIONS_PER_PAGE} seções por página. Não invente seções que a referência não tem, a não ser que o briefing exija.`,
    ...INSPIRATION_RULES,
    'Não copie textos, nomes de marca, logos nem fotos das referências; elas descrevem apenas o design.',
  ].join('\n')
}

/** What the plan call sees of each reference: spec without the noise. */
export function describeSpecForPlan(spec: DesignSpec): string {
  const sections = spec.sections
    .map(
      (section, index) =>
        `  [${index}] ${section.type} — ${section.layout} (fundo ${section.backgroundKind}${section.backgroundColor ? ` ${section.backgroundColor}` : ''}; elementos: ${section.elements.join(', ')}; equivalente: ${section.equivalent})`,
    )
    .join('\n')
  return [
    `${spec.source}: ${spec.summary}`,
    `Estilo mais próximo: ${spec.kit}. Seções:`,
    sections,
  ].join('\n')
}

export async function planFidelityPages(input: {
  llm: FidelityLlm
  brief: string[]
  kinds: SitePageKind[]
  specs: DesignSpec[]
  focus: string
}): Promise<FidelityPlanOutput | null> {
  const answer = await structuredCall({
    provider: input.llm.provider,
    model: input.llm.model,
    system: buildFidelityPlanSystem(input.kinds),
    message: [
      'Briefing:',
      ...input.brief,
      ...(input.focus
        ? [`O que aproveitar, segundo o cliente: ${input.focus}`]
        : []),
      '',
      'Referências analisadas (a primeira é a principal):',
      ...input.specs.map(describeSpecForPlan),
    ].join('\n'),
    schemaName: 'fidelity_plan',
    jsonSchema: FIDELITY_PLAN_JSON_SCHEMA,
    schema: fidelityPlanSchema,
    maxTokens: FIDELITY_PLAN_MAX_TOKENS,
    onUsage: input.llm.onUsage,
  })
  return answer.ok ? answer.value : null
}
