/**
 * Front C of the reference-faithful site generation (docs/site-ai-
 * fidelity.md, ADR 0072): render the draft, compare it with the references
 * and redraw the sections that diverge.
 */
export {
  type CompareInput,
  type CompareResult,
  compareSection,
  type SectionComparison,
  type SectionDifference,
} from './compare'
export { type RefineConfig, resolveRefineConfig } from './config'
export {
  type RefinedSection,
  type RefineOutcome,
  refineDraft,
  type StopReason,
} from './refine'
export { createDraftRenderer } from './render'
export {
  type DraftRenderer,
  getDraftRenderer,
  registerDraftRenderer,
  runRefinement,
} from './run'
export { createSectionRecorder, type SectionRecorder } from './targets'
