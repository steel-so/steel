import type {
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
  DocumentSettingsDTO,
} from '@/src/schemas/document.schema'
import type { DocumentVariableKey } from './constants'

/**
 * Render context of the `document` catalog (ADR 0063).
 *
 * - `editor`: inside the canvas; functional elements are visual only.
 * - `public`: the recipient's link; functional elements read and write the
 *   runtime below (provided by the public page through React context).
 * - `print`: static HTML for the PDF export; no scripts, page breaks on.
 */
export type DocumentRenderMode = 'editor' | 'public' | 'print'

/** Values of the merge tags, already formatted for pt-BR. */
export type DocumentVariableValues = Partial<
  Record<DocumentVariableKey, string>
>

export interface DocumentRenderContext {
  mode: DocumentRenderMode
  settings: DocumentSettingsDTO
  variables: DocumentVariableValues
  /** End of validity (ISO), for the `validity` element. */
  validUntil?: string | null
  /** Workspace logo/name for the default header blocks. */
  brand?: { name: string; logoUrl?: string | null }
  /** Payment is shown only when the workspace PSP is on (C6 flag). */
  paymentEnabled?: boolean
  /** IANA timezone of the workspace for the dates the document shows
   * (validity, accept); defaults to America/Sao_Paulo. */
  timeZone?: string
  /** Print mode: answers of the recipient to show filled in (PDF of an
   * accepted document). Public mode reads the runtime instead. */
  fieldValues?: DocumentFieldValuesDTO
  /** Print mode: pricing selection of the recipient. */
  selection?: DocumentPricingSelectionDTO
  /** Print mode: who accepted and when (ISO). */
  acceptedByName?: string | null
  acceptedAt?: string | null
}

/** One line of a `pricing-table` node (`props.items`). */
export interface DocumentPricingItem {
  id: string
  /** CRM product it came from, when picked from the catalog. */
  productId?: string | null
  name: string
  description?: string
  unit?: string
  /** BRL, two decimals. */
  unitPrice: number
  quantity: number
  /** 0–100, applied to the line. */
  discountPct?: number
  /** Optional line: the reader can tick it on or off. */
  optional?: boolean
  /** Starts ticked (only meaningful when optional). */
  selectedByDefault?: boolean
  /** The reader can change the quantity. */
  quantityEditable?: boolean
  /** Recurring lines are summed separately ("por mês"). */
  recurrence?: 'once' | 'monthly' | 'yearly'
}

/** Props every `field-*` node carries (catalog adds its own visual props). */
export interface DocumentFieldProps {
  label: string
  required?: boolean
  placeholder?: string
  helpText?: string
  /** `field-select` options. */
  options?: string[]
  /** `field-select` allows many. */
  multiple?: boolean
  /** Maps the answer to a CRM field on accept (e.g. `person.phone`). */
  crmField?: string
}

export type DocumentRuntimeStatus = 'open' | 'accepted' | 'declined' | 'expired'

export type DocumentActionResult = { ok: true } | { ok: false; message: string }

/**
 * State and actions of the public link, provided by the public page
 * (`DocumentRuntimeProvider` in `runtime-context.tsx`). Functional elements
 * read it with `useDocumentRuntime()`; it is `null` in editor and print modes.
 */
export interface DocumentRuntime {
  versionId: string
  status: DocumentRuntimeStatus
  acceptedByName?: string | null
  acceptedAt?: string | null
  /** The current reader may accept/decline (APPROVER or generic link). */
  canAccept: boolean
  canDownload: boolean
  fieldValues: DocumentFieldValuesDTO
  fieldErrors: Record<string, string>
  selection: DocumentPricingSelectionDTO
  setFieldValue: (
    fieldId: string,
    value: DocumentFieldValuesDTO[string],
  ) => void
  setSelection: (
    itemId: string,
    value: DocumentPricingSelectionDTO[string],
  ) => void
  accept: (input: {
    name: string
    email?: string
  }) => Promise<DocumentActionResult>
  decline: (input: {
    name?: string
    reason?: string
  }) => Promise<DocumentActionResult>
  submitFields: () => Promise<DocumentActionResult>
  downloadPdf: () => Promise<DocumentActionResult>
  startCheckout?: (method: 'PIX' | 'BOLETO') => Promise<DocumentActionResult>
}
