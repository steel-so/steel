import { appError } from '@/src/errors/app-error'
import type { NodeSpec } from '@/src/lib/canvas-site/presets/builder'
import { err, type Result } from '@/src/lib/result'
import { runLimited } from '../blueprint/llm'
import type { SectionBlueprint } from '../blueprint/section-blueprint'
import type { ReferenceCapture } from '../types'
import type {
  CompareInput,
  CompareResult,
  SectionComparison,
  SectionDifference,
} from './compare'
import type { RefineConfig } from './config'
import { describeRange, pickStrips, type SectionRange } from './ranges'

/**
 * The refinement loop (ADR 0072): render the draft, compare every section
 * with its reference, redraw the sections under the target score with the
 * differences as instructions, render again and keep only the changes that
 * raised the score. Everything that touches the outside world (browser,
 * model, the draft's documents) is injected, so the loop is plain logic.
 *
 * Safety: a failure of the renderer or the comparison never throws — the
 * loop stops and the draft keeps its last verified state (unverified
 * redraws are undone).
 */

/** Sections compared or redrawn at the same time. */
export const REFINE_CONCURRENCY = 3
/** A redraw must beat the previous score by this much to be kept. */
export const MIN_SCORE_GAIN = 2

export interface RefineTarget {
  id: string
  pageIndex: number
  sectionIndex: number
  name: string
  /** What the section says for the company (context for the comparison). */
  purpose: string
  referenceImages: string[]
  referenceNote: string
  /** Blueprint currently in the draft (null for a ready section). */
  blueprint: SectionBlueprint | null
}

export interface RedrawInput {
  target: RefineTarget
  blueprint: SectionBlueprint | null
  differences: SectionDifference[]
  score: number
  /** Pictures of the section as rendered now. */
  draftImages: string[]
  round: number
}

export type RedrawResult =
  | { ok: true; spec: NodeSpec; blueprint: SectionBlueprint }
  | { ok: false; problems: string[] }

/** The draft being refined: its documents live behind this interface. */
export interface RefineDraft {
  render(pageIndex: number): Promise<Result<ReferenceCapture>>
  /** Section ranges of the rendered page (null = positions unreliable). */
  ranges(capture: ReferenceCapture, pageIndex: number): SectionRange[] | null
  /** Puts a new section in the draft; `undo` takes exactly it back out. */
  swap(
    pageIndex: number,
    sectionIndex: number,
    spec: NodeSpec,
  ): { ok: true; undo: () => void } | { ok: false }
}

export type StopReason =
  | 'target'
  | 'stalled'
  | 'rounds'
  | 'time'
  | 'quota'
  | 'render_failed'
  | 'compare_failed'

export interface RefineInput {
  draft: RefineDraft
  targets: RefineTarget[]
  config: RefineConfig
  compare: (
    input: Omit<CompareInput, 'llm'> & { target: RefineTarget },
  ) => Promise<CompareResult>
  redraw: (input: RedrawInput) => Promise<RedrawResult>
  onProgress: (label: string) => void
  /** True when the monthly AI quota is spent. */
  overBudget?: () => boolean
  now?: () => number
}

export interface RefinedSection {
  id: string
  name: string
  pageIndex: number
  sectionIndex: number
  /** `null` = never compared. */
  initialScore: number | null
  finalScore: number | null
  fixes: number
}

export interface RefineOutcome {
  /** Fix cycles run. */
  rounds: number
  stoppedBy: StopReason
  sections: RefinedSection[]
  averageBefore: number | null
  averageAfter: number | null
  /** Redraws kept in the draft. */
  replaced: number
  /** pt-BR notes for the user. */
  warnings: string[]
}

interface Pending {
  undo: () => void
  previousBlueprint: SectionBlueprint | null
  previousScore: number
  previousDifferences: SectionDifference[]
  previousImages: string[]
}

interface State {
  target: RefineTarget
  blueprint: SectionBlueprint | null
  score: number | null
  initialScore: number | null
  differences: SectionDifference[]
  draftImages: string[]
  stalled: boolean
  fixes: number
  pending: Pending | null
}

function average(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0
    ? null
    : Math.round(known.reduce((sum, value) => sum + value, 0) / known.length)
}

export async function refineDraft(input: RefineInput): Promise<RefineOutcome> {
  const { config, draft } = input
  const now = input.now ?? Date.now
  const startedAt = now()
  const warnings: string[] = []
  const states: State[] = input.targets.map((target) => ({
    target,
    blueprint: target.blueprint,
    score: null,
    initialScore: null,
    differences: [],
    draftImages: [],
    stalled: false,
    fixes: 0,
    pending: null,
  }))
  let rounds = 0
  let replaced = 0
  let stoppedBy: StopReason = 'target'
  let dirty = new Set(states.map((state) => state.target.pageIndex))

  const stopReason = (): StopReason | null => {
    if (now() - startedAt > config.budgetMs) return 'time'
    return input.overBudget?.() ? 'quota' : null
  }

  const revert = (state: State) => {
    const pending = state.pending
    if (!pending) return
    pending.undo()
    state.blueprint = pending.previousBlueprint
    state.score = pending.previousScore
    state.differences = pending.previousDifferences
    state.draftImages = pending.previousImages
    state.pending = null
  }

  const apply = (
    state: State,
    comparison: SectionComparison,
    images: string[],
  ) => {
    const pending = state.pending
    if (pending && comparison.score < pending.previousScore + MIN_SCORE_GAIN) {
      revert(state)
      state.stalled = true
      return
    }
    if (pending) {
      state.fixes++
      replaced++
      state.pending = null
    }
    state.score = comparison.score
    if (state.initialScore === null) state.initialScore = comparison.score
    state.differences = comparison.differences
    state.draftImages = images
  }

  for (;;) {
    // 1. Render the pages that changed and compare their sections.
    const early = stopReason()
    if (early) {
      stoppedBy = early
      break
    }
    input.onProgress(
      rounds === 0
        ? 'Comparando com a referência…'
        : `Comparando com a referência (rodada ${rounds})…`,
    )
    let compared = 0
    let renderFailures = 0
    let compareFailures = 0
    let interrupted: StopReason | null = null
    for (const pageIndex of [...dirty].sort((a, b) => a - b)) {
      interrupted = stopReason()
      if (interrupted) break
      const group = states.filter(
        (state) =>
          state.target.pageIndex === pageIndex &&
          (rounds === 0 ? !state.stalled : state.pending !== null),
      )
      if (group.length === 0) continue
      let rendered: Result<ReferenceCapture>
      try {
        rendered = await draft.render(pageIndex)
      } catch {
        rendered = err(
          appError('INTERNAL_SERVER_ERROR', 'Falha ao renderizar o rascunho.'),
        )
      }
      const ranges = rendered.ok
        ? draft.ranges(rendered.value, pageIndex)
        : null
      if (!rendered.ok || !ranges) {
        renderFailures++
        if (rounds > 0) {
          warnings.push(
            'Não foi possível renderizar o rascunho de novo; as mudanças não conferidas foram desfeitas.',
          )
        }
        for (const state of group) {
          revert(state)
          state.stalled = true
        }
        continue
      }
      const capture = rendered.value
      await runLimited(
        group.map((state) => async () => {
          if (stopReason()) return
          const range = ranges[state.target.sectionIndex]
          if (!range) {
            revert(state)
            state.stalled = true
            return
          }
          const pick = pickStrips(capture, range)
          const result = await input
            .compare({
              target: state.target,
              sectionName: state.target.name,
              purpose: state.target.purpose,
              referenceImages: state.target.referenceImages,
              referenceNote: state.target.referenceNote,
              draftImages: pick.images,
              draftNote: describeRange(pick, range, capture.desktop.width),
            })
            .catch(
              (): CompareResult => ({
                ok: false,
                problems: ['Falha ao comparar'],
              }),
            )
          if (!result.ok) {
            compareFailures++
            revert(state)
            state.stalled = true
            return
          }
          compared++
          apply(state, result.comparison, pick.images)
        }),
        REFINE_CONCURRENCY,
      )
    }
    dirty = new Set()
    // What was not verified (time or quota ran out) goes back.
    const stopped = interrupted ?? stopReason()
    if (stopped) {
      stoppedBy = stopped
      break
    }
    if (rounds === 0 && compared === 0) {
      stoppedBy = renderFailures > 0 ? 'render_failed' : 'compare_failed'
      break
    }
    if (compareFailures > 0 && compared === 0) {
      stoppedBy = 'compare_failed'
      break
    }

    // 2. Redraw the sections under the target.
    const candidates = states.filter(
      (state) =>
        !state.stalled &&
        state.pending === null &&
        state.score !== null &&
        state.score < config.targetScore &&
        state.differences.length > 0,
    )
    if (candidates.length === 0) {
      stoppedBy = states.some(
        (state) =>
          state.stalled &&
          (state.score === null || state.score < config.targetScore),
      )
        ? 'stalled'
        : 'target'
      break
    }
    if (rounds >= config.maxRounds) {
      stoppedBy = 'rounds'
      break
    }
    rounds++
    await runLimited(
      candidates.map((state) => async () => {
        if (stopReason()) return
        const { target } = state
        input.onProgress(
          `Ajustando a seção "${target.name}" (rodada ${rounds})…`,
        )
        const redrawn = await input
          .redraw({
            target,
            blueprint: state.blueprint,
            differences: state.differences,
            score: state.score ?? 0,
            draftImages: state.draftImages,
            round: rounds,
          })
          .catch(
            (): RedrawResult => ({
              ok: false,
              problems: ['Falha ao redesenhar'],
            }),
          )
        if (!redrawn.ok) {
          state.stalled = true
          return
        }
        const swapped = draft.swap(
          target.pageIndex,
          target.sectionIndex,
          redrawn.spec,
        )
        if (!swapped.ok) {
          state.stalled = true
          return
        }
        state.pending = {
          undo: swapped.undo,
          previousBlueprint: state.blueprint,
          previousScore: state.score ?? 0,
          previousDifferences: state.differences,
          previousImages: state.draftImages,
        }
        state.blueprint = redrawn.blueprint
        dirty.add(target.pageIndex)
      }),
      REFINE_CONCURRENCY,
    )
    if (dirty.size === 0) {
      stoppedBy = stopReason() ?? 'stalled'
      break
    }
  }

  // Anything still unverified is taken out of the draft.
  for (const state of states) revert(state)

  const sections: RefinedSection[] = states.map((state) => ({
    id: state.target.id,
    name: state.target.name,
    pageIndex: state.target.pageIndex,
    sectionIndex: state.target.sectionIndex,
    initialScore: state.initialScore,
    finalScore: state.score,
    fixes: state.fixes,
  }))
  const below = sections.filter(
    (section) =>
      section.finalScore !== null && section.finalScore < config.targetScore,
  )
  warnings.push(...stopWarnings(stoppedBy, below, config))
  return {
    rounds,
    stoppedBy,
    sections,
    averageBefore: average(sections.map((section) => section.initialScore)),
    averageAfter: average(sections.map((section) => section.finalScore)),
    replaced,
    warnings,
  }
}

function stopWarnings(
  reason: StopReason,
  below: RefinedSection[],
  config: RefineConfig,
): string[] {
  const names = below
    .slice(0, 4)
    .map((section) => `"${section.name}"`)
    .join(', ')
  const rest = below.length > 4 ? ` e mais ${below.length - 4}` : ''
  const list =
    below.length > 0 ? ` Seções abaixo da meta: ${names}${rest}.` : ''
  switch (reason) {
    case 'time':
      return [
        `O ajuste fino parou por limite de tempo; o rascunho ficou com o que já tinha sido conferido.${list}`,
      ]
    case 'quota':
      return [`O ajuste fino parou porque a cota mensal de IA acabou.${list}`]
    case 'render_failed':
      return [
        'Não foi possível renderizar o rascunho para compará-lo com as referências; o site ficou sem o ajuste fino.',
      ]
    case 'compare_failed':
      return [
        'A IA não conseguiu comparar o rascunho com as referências; o site ficou sem o ajuste fino.',
      ]
    case 'rounds':
      return [
        `O ajuste fino usou as ${config.maxRounds} rodadas permitidas.${list}`,
      ]
    case 'stalled':
      return below.length > 0
        ? [`O ajuste fino parou: as seções deixaram de melhorar.${list}`]
        : []
    default:
      return []
  }
}
