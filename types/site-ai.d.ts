import type { CanvasFragment } from '@/src/lib/canvas/types'
import type { SiteDTO } from './site'

/** Monthly AI quota of the workspace (ADR 0007), in US$. */
export interface SiteAiQuotaDTO {
  usedUsd: number
  quotaUsd: number
  remainingUsd: number
  exceeded: boolean
}

/** Estimated cost (US$) of each AI action with the workspace's model. */
export interface SiteAiEstimateDTO {
  /** Theme and page tree of a generated site. */
  planUsd: number
  /** Copy of one generated page. */
  pageUsd: number
  /** "Gerar seção com IA". */
  sectionUsd: number
  /** "Reescrever textos da página". */
  rewriteUsd: number
  /** "Sugerir imagens". */
  imagesUsd: number
  /** Model label shown next to the estimate. */
  model: string
}

export interface SiteAiProductDTO {
  id: string
  name: string
  description: string
  /** Formatted in pt-BR (`R$ 99,90`). */
  price: string
}

export interface SiteAiFormDTO {
  id: string
  name: string
  publicToken: string
}

/** Everything the guided form prefills and the quota/cost box shows. */
export interface SiteAiContextDTO {
  /** The AI can run (plan feature, provider with a key). */
  available: boolean
  /** pt-BR reason when `available` is false. */
  unavailableReason: string | null
  brand: {
    companyName: string
    logoUrl: string
    primaryColor: string
    website: string
  }
  products: SiteAiProductDTO[]
  /** Testimonials found in the workspace's landing pages. */
  testimonials: number
  /** Published CRM forms (the contact section's form). */
  forms: SiteAiFormDTO[]
  /** The actor may create CRM forms ("Criar formulário de contato"). */
  canCreateForm: boolean
  quota: SiteAiQuotaDTO
  estimate: SiteAiEstimateDTO | null
}

export type SiteAiStepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface SiteAiStep {
  id: string
  label: string
  status: SiteAiStepStatus
}

/**
 * Event of the generation stream (`text/event-stream`, one JSON object per
 * `data:` line): the step list once, step updates, then exactly one `done`
 * or `error`.
 */
export type SiteAiEvent =
  | { type: 'steps'; steps: SiteAiStep[] }
  | {
      type: 'step'
      id: string
      label: string
      status: SiteAiStepStatus
    }
  | {
      type: 'done'
      site: SiteDTO
      costUsd: number
      /** pt-BR notes (a section left with sample copy, no form…). */
      warnings: string[]
    }
  | { type: 'error'; code: string; message: string }

export interface SiteAiSectionResultDTO {
  reply: string
  /** Validated fragment of one `site.section` (fresh ids). */
  fragment: CanvasFragment
  costUsd: number
}

/** New top-level props per node, ready for `update` ops. */
export interface SiteAiNodeChange {
  nodeId: string
  set: Record<string, unknown>
}

export interface SiteAiRewriteResultDTO {
  changes: SiteAiNodeChange[]
  /** Texts the AI rewrote (fields, not nodes). */
  rewritten: number
  costUsd: number
}

export interface SiteAiImageSuggestionDTO {
  nodeId: string
  /** Current image, for the before/after. */
  currentSrc: string
  src: string
  alt: string
  /** pt-BR description of the ideal photo, to shoot or license later. */
  idea: string
  source: 'library' | 'placeholder' | 'current'
  /** Intrinsic size of the new file when known (placeholders); `null`
   * clears the old one so the browser measures the new image. */
  dimensions: { width: number; height: number } | null
}

export interface SiteAiImagesResultDTO {
  suggestions: SiteAiImageSuggestionDTO[]
  costUsd: number
}
