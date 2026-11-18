import type { NodeSpec } from '@/src/lib/canvas-site/presets/builder'
import type { SiteKitId } from '@/src/lib/canvas-site/presets/kits'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'
import type { SitePageKind } from '@/src/lib/site-ai/plan'
import {
  buildSection,
  type SectionContext,
  type SiteAiSection,
} from '@/src/lib/site-ai/sections'
import {
  type AnalysisOutcome,
  analyzeReferences as defaultAnalyze,
} from './analyze'
import type { DesignSpec } from './design-spec'
import {
  type BuiltSection,
  buildFidelitySection,
  type SectionOrigin,
  type SectionReference,
} from './generate'
import { type FidelityLlm, runLimited } from './llm'
import {
  type FidelityAvailability,
  type FidelityPlan,
  type FidelityPlanPage,
  normalizeFidelityPlan,
  planFidelityPages,
} from './plan'
import type { ReferenceSource } from './references'
import { designSpecToTheme } from './theme'

/**
 * The reference-faithful generation, from sources to page trees:
 *
 *   analyze every reference (DesignSpec) → plan the pages (sections that
 *   follow reference sections) → theme from the primary reference → draw
 *   every section (blueprint, or the ready section as the fallback).
 *
 * It returns `NodeSpec` lists per page; the caller turns them into
 * documents, writes the copy of the ready sections, saves and meters. All
 * progress goes through `onProgress` (the stream's step events).
 */

/** Sections drawn at the same time, across all pages. */
export const SECTION_CONCURRENCY = 4
/** After this long, the remaining sections use the ready ones. */
export const FIDELITY_BUDGET_MS = 20 * 60_000

export interface FidelityProgress {
  /** `analysis`, `theme` or `page:<kind>`. */
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
}

export interface FidelityPageResult {
  kind: SitePageKind
  /** Section specs in page order. */
  specs: NodeSpec[]
  /** How each section was built (same order as `specs`). */
  origins: SectionOrigin[]
  /** `equivalent` of each section (same order). */
  equivalents: SiteAiSection[]
  warnings: string[]
}

export type FidelityResult =
  | {
      ok: true
      plan: FidelityPlan
      theme: SiteTheme
      kit: SiteKitId
      specs: DesignSpec[]
      pages: FidelityPageResult[]
      warnings: string[]
    }
  | {
      ok: false
      reason: 'no_reference' | 'analysis_failed'
      warnings: string[]
    }

export interface FidelityInput {
  llm: FidelityLlm
  brief: string[]
  focus: string
  kinds: SitePageKind[]
  name: string
  defaultCtaLabel: string
  /** Brand color the customer typed; wins over the reference's primary. */
  primaryColor: string | null
  availability: FidelityAvailability
  sources: ReferenceSource[]
  /** Context the ready sections of a page are built with. */
  sectionContext: (
    page: FidelityPlanPage,
    plan: FidelityPlan,
    kit: SiteKitId,
  ) => SectionContext
  onProgress: (progress: FidelityProgress) => void
  budgetMs?: number
  /** True when the workspace's monthly AI quota is spent: the sections
   * still to draw use the ready ones instead of calling the model. */
  overBudget?: () => boolean
  /** Test seams. */
  deps?: {
    analyze?: typeof defaultAnalyze
    plan?: typeof planFidelityPages
    build?: typeof buildFidelitySection
    now?: () => number
  }
}

export async function runFidelityPipeline(
  input: FidelityInput,
): Promise<FidelityResult> {
  const analyze = input.deps?.analyze ?? defaultAnalyze
  const planPages = input.deps?.plan ?? planFidelityPages
  const build = input.deps?.build ?? buildFidelitySection
  const now = input.deps?.now ?? Date.now
  const warnings: string[] = []
  const startedAt = now()
  const budgetMs = input.budgetMs ?? FIDELITY_BUDGET_MS
  let quotaWarned = false
  const timeUp = () => now() - startedAt > budgetMs
  const quotaSpent = () => {
    const spent = input.overBudget?.() ?? false
    if (spent && !quotaWarned) {
      quotaWarned = true
      warnings.push(
        'A cota mensal de IA acabou durante a geração: as seções restantes usam os modelos prontos.',
      )
    }
    return spent
  }

  // 1. Visual analysis.
  if (input.sources.length === 0) {
    return { ok: false, reason: 'no_reference', warnings }
  }
  input.onProgress({
    id: 'analysis',
    label: 'Analisando as referências…',
    status: 'running',
  })
  const outcomes: AnalysisOutcome[] = await analyze({
    llm: input.llm,
    sources: input.sources,
    focus: input.focus,
  })
  const analyses = outcomes.filter(
    (outcome): outcome is Extract<AnalysisOutcome, { ok: true }> => outcome.ok,
  )
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      warnings.push(
        `Não foi possível analisar a referência ${outcome.source.label}; ela não influenciou o layout.`,
      )
    }
  }
  if (analyses.length === 0) {
    input.onProgress({
      id: 'analysis',
      label: 'Não foi possível analisar as referências',
      status: 'failed',
    })
    return { ok: false, reason: 'analysis_failed', warnings }
  }
  input.onProgress({
    id: 'analysis',
    label:
      analyses.length === outcomes.length
        ? 'Referências analisadas'
        : `${analyses.length} de ${outcomes.length} referências analisadas`,
    status: 'done',
  })
  const specs = analyses.map((analysis) => analysis.spec)
  const primary = specs[0]
  const bySource = new Map<string, SectionReference['source']>(
    analyses.map((analysis) => [analysis.source.id, analysis.source]),
  )

  // 2. Plan and theme.
  input.onProgress({
    id: 'theme',
    label: 'Planejando o site a partir das referências…',
    status: 'running',
  })
  const rawPlan = await planPages({
    llm: input.llm,
    brief: input.brief,
    kinds: input.kinds,
    specs,
    focus: input.focus,
  })
  if (!rawPlan) {
    warnings.push(
      'A IA não montou o plano a partir das referências; usamos as seções padrão no estilo delas.',
    )
  }
  const plan = normalizeFidelityPlan(rawPlan, {
    kinds: input.kinds,
    name: input.name,
    defaultCtaLabel: input.defaultCtaLabel,
    availability: input.availability,
    referenceEquivalents: Object.fromEntries(
      specs.map((spec) => [
        spec.source,
        spec.sections.map((section) => section.equivalent),
      ]),
    ),
  })
  const theme = designSpecToTheme(primary, { primaryColor: input.primaryColor })
  input.onProgress({ id: 'theme', label: 'Tema criado', status: 'done' })

  // 3. Sections, a few at a time across all pages.
  const results: FidelityPageResult[] = plan.pages.map((page) => ({
    kind: page.kind,
    specs: new Array<NodeSpec>(page.sections.length),
    origins: new Array<SectionOrigin>(page.sections.length),
    equivalents: page.sections.map((section) => section.equivalent),
    warnings: [],
  }))
  const remaining = plan.pages.map((page) => page.sections.length)
  const tasks: Array<() => Promise<void>> = []
  for (const [pageIndex, page] of plan.pages.entries()) {
    const stepId = `page:${page.kind}`
    const sectionCtx = input.sectionContext(page, plan, primary.kit)
    for (const [index, planned] of page.sections.entries()) {
      tasks.push(async () => {
        const reference = referenceFor(planned, specs, bySource)
        input.onProgress({
          id: stepId,
          label: `Desenhando a seção "${planned.name}" da página ${page.title}…`,
          status: 'running',
        })
        let built: BuiltSection
        try {
          built = await build({
            llm: input.llm,
            request: {
              planned,
              pageTitle: page.title,
              index,
              total: page.sections.length,
              primary,
              reference,
              brief: input.brief,
              focus: input.focus,
              companyName: input.name,
              ctaLabel: plan.ctaLabel,
            },
            sectionCtx,
            brandColor: input.primaryColor,
            skipDrawing: timeUp() || quotaSpent(),
          })
        } catch {
          built = {
            spec: buildSection(planned.equivalent, sectionCtx),
            origin: 'ready',
            warning: `A seção "${planned.name}" da página ${page.title} usou o modelo pronto.`,
          }
        }
        results[pageIndex].specs[index] = built.spec
        results[pageIndex].origins[index] = built.origin
        if (built.warning) results[pageIndex].warnings.push(built.warning)
        remaining[pageIndex]--
        if (remaining[pageIndex] === 0) {
          input.onProgress({
            id: stepId,
            label: `Página ${page.title} pronta`,
            status: 'done',
          })
        }
      })
    }
  }
  await runLimited(tasks, SECTION_CONCURRENCY)
  for (const page of results) warnings.push(...page.warnings)

  return {
    ok: true,
    plan,
    theme,
    kit: primary.kit,
    specs,
    pages: results,
    warnings,
  }
}

function referenceFor(
  planned: FidelityPlanPage['sections'][number],
  specs: DesignSpec[],
  sources: Map<string, ReferenceSource>,
): SectionReference | null {
  if (planned.referenceId === null) return null
  const spec = specs.find((item) => item.source === planned.referenceId)
  const source = sources.get(planned.referenceId)
  if (!spec || !source) return null
  return {
    source,
    spec,
    section:
      planned.referenceSection === null
        ? null
        : (spec.sections[planned.referenceSection] ?? null),
  }
}
