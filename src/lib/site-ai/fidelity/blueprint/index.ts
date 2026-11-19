/**
 * Front B of the reference-faithful site generation (docs/site-ai-
 * fidelity.md): visual analysis (`DesignSpec`), section blueprints, the
 * compiler to the builder's node specs and the pipeline that ties them.
 */
export { analyzeReference, analyzeReferences } from './analyze'
export { blueprintToNodeSpec } from './compile'
export {
  DESIGN_SPEC_JSON_SCHEMA,
  type DesignSection,
  type DesignSpec,
  designSpecSchema,
  normalizeDesignSpec,
} from './design-spec'
export {
  type BuiltSection,
  buildFidelitySection,
  generateSectionBlueprint,
  type SectionOrigin,
  type SectionRefinement,
  type SectionRequest,
} from './generate'
export type { FidelityLlm } from './llm'
export {
  fidelityPageDocument,
  pickReadySlots,
} from './page'
export {
  type FidelityInput,
  type FidelityPageResult,
  type FidelityProgress,
  type FidelityResult,
  runFidelityPipeline,
} from './pipeline'
export {
  type FidelityPlan,
  type FidelityPlanPage,
  normalizeFidelityPlan,
  type PlannedSection,
} from './plan'
export {
  buildReferenceSources,
  isAnalyzable,
  type ReferenceSource,
} from './references'
export {
  SECTION_BLUEPRINT_JSON_SCHEMA,
  type SectionBlueprint,
  sectionBlueprintSchema,
} from './section-blueprint'
export { designSpecToTheme } from './theme'
