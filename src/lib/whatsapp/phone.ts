/**
 * A contact's `waId` is its phone (digits) or, when Meta reports only a
 * business-scoped user ID (`BR.123…`), that BSUID.
 */
export function isWhatsAppPhone(waId: string): boolean {
  return /^\d+$/.test(waId)
}

/** `+5511…` for a phone; a plain notice for a BSUID-only contact. */
export function formatWaId(waId: string): string {
  return isWhatsAppPhone(waId) ? `+${waId}` : 'sem telefone'
}
