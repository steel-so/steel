import { CONTACT_ANCHOR, type SectionContext } from '@/src/lib/site-ai/sections'
import {
  type BuiltSection,
  buildFidelitySection,
  type FidelityResult,
  generateSectionBlueprint,
  type SectionBlueprint,
  type SectionRequest,
} from '../blueprint'
import { DATA_SECTIONS, type PlannedSection } from '../blueprint/plan'
import { differencesToInstructions } from './compare'
import { describeRange, pickStrips } from './ranges'
import type { RedrawInput, RedrawResult, RefineTarget } from './refine'

/**
 * Bridges the fidelity pipeline and the refinement: the recorder keeps the
 * request, context and blueprint of every section while the pipeline draws
 * it, and `buildRefineTargets` turns them into comparable targets (the
 * reference pictures of each section).
 */

export interface SectionRecord {
  request: SectionRequest
  sectionCtx: SectionContext
  brandColor: string | null
  /** Blueprint the section was drawn from (null for a ready section). */
  blueprint: SectionBlueprint | null
  origin: BuiltSection['origin']
}

/** Records by planned section object (identity is stable in the plan). */
export interface SectionRecorder {
  records: Map<PlannedSection, SectionRecord>
  /** Drop-in for the pipeline's `deps.build`. */
  build: typeof buildFidelitySection
}

export function createSectionRecorder(): SectionRecorder {
  const records = new Map<PlannedSection, SectionRecord>()
  const build: typeof buildFidelitySection = async (input) => {
    let blueprint: SectionBlueprint | null = null
    const baseDraw = input.draw ?? generateSectionBlueprint
    const built = await buildFidelitySection({
      ...input,
      draw: async (drawInput) => {
        const result = await baseDraw(drawInput)
        if (result.ok) blueprint = result.blueprint
        return result
      },
    })
    records.set(input.request.planned, {
      request: input.request,
      sectionCtx: input.sectionCtx,
      brandColor: input.brandColor ?? null,
      blueprint: built.origin === 'blueprint' ? blueprint : null,
      origin: built.origin,
    })
    return built
  }
  return { records, build }
}

const DATA_SET = new Set<string>(DATA_SECTIONS)

export interface TargetsOutput {
  targets: RefineTarget[]
  records: Map<string, SectionRecord>
}

/** Targets of the sections that have a reference to be compared with. A
 * section is left out when it carries workspace data (products,
 * testimonials, countdown) or its reference has no usable position. */
export function buildRefineTargets(
  fidelity: Extract<FidelityResult, { ok: true }>,
  recorder: SectionRecorder,
): TargetsOutput {
  const targets: RefineTarget[] = []
  const records = new Map<string, SectionRecord>()
  for (const [pageIndex, page] of fidelity.plan.pages.entries()) {
    for (const [sectionIndex, planned] of page.sections.entries()) {
      const record = recorder.records.get(planned)
      const reference = record?.request.reference
      if (!record || !reference || DATA_SET.has(planned.equivalent)) continue
      const { source, section } = reference
      let referenceImages: string[]
      let referenceNote: string
      if (source.capture) {
        const yStart = section?.yStart
        const yEnd = section?.yEnd
        if (yStart == null || yEnd == null || yEnd <= yStart) continue
        const range = { yStart, yEnd }
        const pick = pickStrips(source.capture, range)
        if (pick.images.length === 0) continue
        referenceImages = pick.images
        referenceNote = describeRange(pick, range, source.capture.desktop.width)
      } else {
        referenceImages = source.images.slice(0, 1)
        if (referenceImages.length === 0) continue
        referenceNote =
          'É uma imagem enviada pelo cliente; pode mostrar a página inteira ou só um trecho: compare com a parte que corresponde a esta seção.'
      }
      const id = `${pageIndex}:${sectionIndex}`
      records.set(id, record)
      targets.push({
        id,
        pageIndex,
        sectionIndex,
        name: planned.name,
        purpose: planned.purpose,
        referenceImages,
        referenceNote,
        blueprint: record.blueprint,
      })
    }
  }
  return { targets, records }
}

/** Redraw of one section with the differences as instructions. */
export function createRedraw(input: {
  records: Map<string, SectionRecord>
  draw: (
    request: SectionRequest,
    record: SectionRecord,
  ) => Promise<RedrawResult>
}): (redraw: RedrawInput) => Promise<RedrawResult> {
  return async (redraw) => {
    const record = input.records.get(redraw.target.id)
    if (!record) return { ok: false, problems: ['Seção desconhecida'] }
    return input.draw(
      {
        ...record.request,
        refinement: {
          previous: redraw.blueprint,
          score: redraw.score,
          differences: differencesToInstructions(redraw.differences),
          draftImages: redraw.draftImages,
          round: redraw.round,
        },
      },
      record,
    )
  }
}

/** Default `draw` of `createRedraw`: the real blueprint call. */
export function blueprintDraw(
  llm: Parameters<typeof generateSectionBlueprint>[0]['llm'],
  timeoutMs?: number,
) {
  return async (
    request: SectionRequest,
    record: SectionRecord,
  ): Promise<RedrawResult> => {
    const result = await generateSectionBlueprint({
      llm,
      request,
      ctx: {
        contactLink: record.sectionCtx.contactLink,
        ...(request.planned.equivalent === 'contact'
          ? { sectionAnchor: CONTACT_ANCHOR }
          : {}),
      },
      brandColor: record.brandColor,
      timeoutMs,
    })
    return result.ok
      ? { ok: true, spec: result.spec, blueprint: result.blueprint }
      : { ok: false, problems: result.problems }
  }
}
