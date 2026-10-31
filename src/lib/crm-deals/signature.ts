import { validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Decoded PNG: up to 1.5 MB (same cap as the ServiceDesk signature). */
const MAX_PNG_BYTES = 1.5 * 1024 * 1024

/** PNG bytes of a data URL (already shaped by the schema), or a validation error. */
export function decodeSignaturePng(dataUrl: string): Result<Buffer> {
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  if (
    buffer.byteLength <= PNG_MAGIC.byteLength ||
    !buffer.subarray(0, PNG_MAGIC.byteLength).equals(PNG_MAGIC)
  ) {
    return err(validationError('A assinatura deve ser uma imagem PNG'))
  }
  if (buffer.byteLength > MAX_PNG_BYTES) {
    return err(validationError('Imagem da assinatura muito grande'))
  }
  return ok(buffer)
}

/** MinIO key of a proposal signature (bucket `crm-proposals`). */
export const CRM_PROPOSAL_BUCKET = 'crm-proposals'

export function proposalSignatureKey(
  workspaceId: string,
  proposalId: string,
  signatureId: string,
): string {
  return `${workspaceId}/${proposalId}/signatures/${signatureId}.png`
}
