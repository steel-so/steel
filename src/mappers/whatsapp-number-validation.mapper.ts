import type { WhatsAppNumberValidation } from '@prisma/client'
import type { WhatsAppNumberValidationDTO } from '@/types/whatsapp-number-validation'

export function toWhatsAppNumberValidationDTO(
  run: WhatsAppNumberValidation,
): WhatsAppNumberValidationDTO {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    connectionId: run.connectionId,
    scope: run.scope,
    scopeId: run.scopeId,
    status: run.status,
    total: run.total,
    processed: run.processed,
    withWhatsapp: run.withWhatsapp,
    withoutWhatsapp: run.withoutWhatsapp,
    failed: run.failed,
    cached: run.cached,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
  }
}
