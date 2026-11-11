/**
 * Progress of an AI import, persisted in `DocumentImport.progress` and
 * pushed to the SSE. Isomorphic: the dialog lists the same steps.
 */

export const DOCUMENT_IMPORT_STEPS = [
  'queued',
  'reading',
  'structure',
  'sections',
  'done',
] as const
export type DocumentImportStep = (typeof DOCUMENT_IMPORT_STEPS)[number]

// A type, not an interface: it is stored as Prisma JSON.
export type DocumentImportProgress = {
  step: DocumentImportStep | 'failed'
  message: string
  pct: number
}

type StepLabels = Record<DocumentImportStep, string>

/** pt-BR label of each step (what the dialog lists). */
export const DOCUMENT_IMPORT_STEP_LABELS: StepLabels = {
  queued: 'Na fila',
  reading: 'Lendo o arquivo',
  structure: 'Entendendo a estrutura',
  sections: 'Montando as seções',
  done: 'Pronto',
}

/** Steps shown for a document written from a request. */
export const DOCUMENT_PROMPT_STEP_LABELS: StepLabels = {
  ...DOCUMENT_IMPORT_STEP_LABELS,
  reading: 'Lendo o pedido',
  structure: 'Planejando o documento',
}

export function stepLabels(prompt: boolean): StepLabels {
  return prompt ? DOCUMENT_PROMPT_STEP_LABELS : DOCUMENT_IMPORT_STEP_LABELS
}

const PCT: Record<DocumentImportStep, number> = {
  queued: 0,
  reading: 10,
  structure: 25,
  sections: 85,
  done: 100,
}

export function progressOf(
  step: DocumentImportStep,
  prompt = false,
): DocumentImportProgress {
  return { step, message: stepLabels(prompt)[step], pct: PCT[step] }
}

/**
 * While the model writes, the share of the expected answer already
 * streamed moves the bar from "structure" towards "sections" (never past
 * 80%: the document still has to be assembled).
 */
export function streamingProgress(
  receivedChars: number,
  expectedChars: number,
  prompt = false,
): DocumentImportProgress {
  const ratio = Math.min(1, receivedChars / Math.max(1, expectedChars))
  const pct = Math.round(PCT.structure + ratio * (80 - PCT.structure))
  const step: DocumentImportStep = ratio < 0.15 ? 'structure' : 'sections'
  return { step, message: stepLabels(prompt)[step], pct }
}

export function failedProgress(message: string): DocumentImportProgress {
  return { step: 'failed', message, pct: 100 }
}

/** Reads the stored JSON back (anything unexpected → empty). */
export function parseProgress(value: unknown): Partial<DocumentImportProgress> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  return {
    ...(typeof raw.step === 'string' && {
      step: raw.step as DocumentImportProgress['step'],
    }),
    ...(typeof raw.message === 'string' && { message: raw.message }),
    ...(typeof raw.pct === 'number' && { pct: raw.pct }),
  }
}
