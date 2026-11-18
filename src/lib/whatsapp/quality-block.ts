/**
 * Fixed start of every message produced by the AI campaign quality gate. It is
 * stored in `WhatsAppAiCampaign.lastError` when a running campaign pauses
 * itself, which is how the UI tells that pause from the other automatic ones.
 * Kept free of server-only imports so client components can use it.
 */
export const QUALITY_BLOCK_PREFIX = 'Envios bloqueados pela qualidade:'

/** True when a campaign `lastError` was written by the quality gate. */
export function isQualityBlockReason(
  reason: string | null | undefined,
): boolean {
  return Boolean(reason?.startsWith(QUALITY_BLOCK_PREFIX))
}
