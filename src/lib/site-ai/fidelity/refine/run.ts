import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { Result } from '@/src/lib/result'
import type { FidelityResult } from '../blueprint'
import type { FidelityLlm } from '../blueprint/llm'
import type { ReferenceCapture } from '../types'
import { type CompareResult, compareSection } from './compare'
import type { RefineConfig } from './config'
import { createDocumentDraft } from './draft'
import type { PreviewDraft } from './preview-store'
import { type RefineOutcome, type RefineTarget, refineDraft } from './refine'
import {
  blueprintDraw,
  buildRefineTargets,
  createRedraw,
  type SectionRecorder,
} from './targets'

/**
 * Entry point of the refinement for the generation service: builds the
 * targets from the fidelity result, runs the loop over the draft's page
 * documents and hands back the (possibly improved) documents.
 */

export type DraftRenderer = (
  draft: PreviewDraft,
  pageIndex: number,
) => Promise<Result<ReferenceCapture>>

let registered: DraftRenderer | null = null

/** Registers the process-wide renderer (tests, or wiring that renders
 * without the worker). `null` clears it. */
export function registerDraftRenderer(renderer: DraftRenderer | null): void {
  registered = renderer
}

export function getDraftRenderer(): DraftRenderer | null {
  return registered
}

export interface RunRefinementInput {
  fidelity: Extract<FidelityResult, { ok: true }>
  recorder: SectionRecorder
  llm: FidelityLlm
  config: RefineConfig
  theme: unknown
  header: CanvasDocument | null
  footer: CanvasDocument | null
  /** Page documents in plan order (final copy, forms attached). */
  pages: Array<{ title: string; document: CanvasDocument }>
  render: DraftRenderer
  prepare?: (document: CanvasDocument) => void
  onProgress: (label: string) => void
  overBudget?: () => boolean
  /** Test seams. */
  deps?: {
    compare?: typeof compareSection
    now?: () => number
  }
}

export type RunRefinementResult =
  | { ran: false; reason: string }
  | { ran: true; outcome: RefineOutcome; documents: CanvasDocument[] }

export async function runRefinement(
  input: RunRefinementInput,
): Promise<RunRefinementResult> {
  if (input.config.maxRounds <= 0) return { ran: false, reason: 'disabled' }
  const draft = createDocumentDraft({
    theme: input.theme,
    header: input.header,
    footer: input.footer,
    pages: input.pages,
    render: input.render,
    prepare: input.prepare,
  })
  const { targets: all, records } = buildRefineTargets(
    input.fidelity,
    input.recorder,
  )
  // A page whose sections were dropped no longer lines up with the plan.
  const targets: RefineTarget[] = all.filter(
    (target) =>
      draft.sectionCount(target.pageIndex) ===
      input.fidelity.plan.pages[target.pageIndex]?.sections.length,
  )
  if (targets.length === 0) return { ran: false, reason: 'no_targets' }
  const compare = input.deps?.compare ?? compareSection
  const outcome = await refineDraft({
    draft,
    targets,
    config: input.config,
    compare: (compareInput): Promise<CompareResult> =>
      compare({ ...compareInput, llm: input.llm }),
    redraw: createRedraw({
      records,
      draw: blueprintDraw(input.llm),
    }),
    onProgress: input.onProgress,
    overBudget: input.overBudget,
    now: input.deps?.now,
  })
  return { ran: true, outcome, documents: draft.documents() }
}
