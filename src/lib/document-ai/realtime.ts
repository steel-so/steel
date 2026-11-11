import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { getQueueConnection } from '@/src/lib/queue/connection'
import type { DocumentImportDTO } from '@/types/document'

/**
 * Live progress of an AI import: the worker publishes the import after
 * every step on `documents:import:<id>` and the SSE
 * `GET .../documents/imports/[importId]/stream` relays it. The event is the
 * whole DTO, so a client that missed one only needs the next.
 */

export function documentImportChannel(importId: string): string {
  return `documents:import:${importId}`
}

/** Never throws: a lost frame is recovered by the next one or by polling. */
export async function publishDocumentImport(
  dto: DocumentImportDTO,
): Promise<void> {
  try {
    await getQueueConnection().publish(
      documentImportChannel(dto.id),
      JSON.stringify(dto),
    )
  } catch (error) {
    logger.warn('documents.import.publish_failed', {
      component: 'DocumentImportRealtime',
      importId: dto.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Subscribes to one import; returns the unsubscribe function. */
export function subscribeDocumentImport(
  importId: string,
  onEvent: (dto: DocumentImportDTO) => void,
): () => void {
  const subscriber = getQueueConnection().duplicate()
  const channel = documentImportChannel(importId)

  subscriber.subscribe(channel).catch((error: unknown) => {
    logger.error('documents.import.subscribe_failed', {
      component: 'DocumentImportRealtime',
      importId,
      message: error instanceof Error ? error.message : String(error),
    })
  })

  subscriber.on('message', (received: string, payload: string) => {
    if (received !== channel) return
    try {
      const parsed = JSON.parse(payload) as DocumentImportDTO
      if (parsed && parsed.id === importId) onEvent(parsed)
    } catch {
      // malformed payload: ignored
    }
  })

  return () => {
    subscriber.unsubscribe(channel).finally(() => {
      subscriber.quit().catch(() => undefined)
    })
  }
}
