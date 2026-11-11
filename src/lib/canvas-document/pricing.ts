import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { DocumentPricingSelectionDTO } from '@/src/schemas/document.schema'
import type { DocumentPricingItem } from './context'

export const DOCUMENT_PRICING_TYPE = 'pricing-table'

export interface DocumentPricingTotals {
  /** One-time total (BRL). */
  once: number
  monthly: number
  yearly: number
  /** Sum of everything, used for `Document.totalValue` and the CRM. */
  total: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isItem(value: unknown): value is DocumentPricingItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.unitPrice === 'number' &&
    typeof item.quantity === 'number'
  )
}

/** Items of every visible `pricing-table` node, in node order. */
export function documentPricingItems(
  doc: CanvasDocument,
): DocumentPricingItem[] {
  const items: DocumentPricingItem[] = []
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== DOCUMENT_PRICING_TYPE || node.meta?.hidden) continue
    const raw = node.props.items
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      if (isItem(item)) items.push(item)
    }
  }
  return items
}

/** Line total after the reader's selection and the line discount. */
export function pricingLineTotal(
  item: DocumentPricingItem,
  selection?: DocumentPricingSelectionDTO,
): number {
  const choice = selection?.[item.id]
  const picked = choice?.selected ?? item.selectedByDefault ?? false
  const selected = item.optional ? picked : true
  if (!selected) return 0
  const quantity =
    item.quantityEditable && choice ? choice.quantity : item.quantity
  const discount = Math.min(Math.max(item.discountPct ?? 0, 0), 100)
  return round2(item.unitPrice * quantity * (1 - discount / 100))
}

/** Totals of the document for a selection (none = the defaults). */
export function documentPricingTotals(
  doc: CanvasDocument,
  selection?: DocumentPricingSelectionDTO,
): DocumentPricingTotals {
  const totals: DocumentPricingTotals = {
    once: 0,
    monthly: 0,
    yearly: 0,
    total: 0,
  }
  for (const item of documentPricingItems(doc)) {
    const line = pricingLineTotal(item, selection)
    const recurrence = item.recurrence ?? 'once'
    totals[recurrence] = round2(totals[recurrence] + line)
    totals.total = round2(totals.total + line)
  }
  return totals
}
