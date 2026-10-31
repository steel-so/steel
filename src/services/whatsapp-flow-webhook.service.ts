import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'

/** `value` of a Meta webhook change with `field: 'flows'`. */
export interface MetaFlowsWebhookValue {
  event?: string
  message?: string
  flow_id?: string
  old_status?: string
  new_status?: string
}

/** Statuses Meta reports for a Flow. */
const KNOWN_STATUSES = new Set([
  'DRAFT',
  'PUBLISHED',
  'DEPRECATED',
  'BLOCKED',
  'THROTTLED',
])

/** Statuses in which Meta refuses to deliver the Flow. */
const SUSPENDED = new Set(['BLOCKED', 'THROTTLED'])

const SUSPENDED_NOTE: Record<string, string> = {
  BLOCKED:
    'A Meta bloqueou este formulário. Corrija o problema indicado no Gerenciador da Meta e publique de novo.',
  THROTTLED:
    'A Meta limitou este formulário por excesso de erros. Os envios podem falhar até a taxa de erros cair.',
}

/**
 * Meta webhook `flows` (Z3 follow-up): a status change of a Flow (published,
 * deprecated, blocked or throttled by Meta) keeps `metaStatus` in step with
 * what Meta really serves. Other Flow events (endpoint health, error rate)
 * are acknowledged and ignored: Steel has no data-exchange endpoint.
 */
export const WhatsAppFlowWebhookService = {
  async applyStatusChange(input: {
    wabaId: string
    value: MetaFlowsWebhookValue
  }): Promise<Result<{ updated: number }>> {
    const { value } = input
    const newStatus = value.new_status?.toUpperCase()
    if (
      value.event !== 'FLOW_STATUS_CHANGE' ||
      !value.flow_id ||
      !newStatus ||
      !KNOWN_STATUSES.has(newStatus)
    ) {
      return ok({ updated: 0 })
    }

    const connections = await WhatsAppConnectionRepository.listByMetaWabaId(
      input.wabaId,
    )
    if (!connections.ok) return connections
    if (connections.value.length === 0) return ok({ updated: 0 })

    const flows = await WhatsAppFlowRepository.listByMetaFlowId(
      value.flow_id,
      connections.value.map((connection) => connection.id),
    )
    if (!flows.ok) return flows

    let updated = 0
    for (const flow of flows.value) {
      if (flow.metaStatus === newStatus) continue
      const wasSuspended = SUSPENDED.has(flow.metaStatus ?? '')
      const saved = await WhatsAppFlowRepository.update(flow.id, {
        metaStatus: newStatus,
        // A Meta-side deprecation retires the Flow here too.
        ...(newStatus === 'DEPRECATED' ? { status: 'DEPRECATED' } : {}),
        // The suspension note shows in the editor; it goes away on recovery.
        ...(SUSPENDED.has(newStatus)
          ? { publishError: SUSPENDED_NOTE[newStatus] }
          : wasSuspended
            ? { publishError: null }
            : {}),
      })
      if (!saved.ok) return saved
      updated += 1
      logger.info('whatsapp.flow.webhook_status', {
        workspaceId: flow.workspaceId,
        flowId: flow.id,
        from: flow.metaStatus,
        to: newStatus,
      })
    }
    return ok({ updated })
  },
}
