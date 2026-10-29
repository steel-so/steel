import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { SdInventoryTargetService } from '@/src/services/sd-inventory-target.service'
import { ServicedeskInventoryJob } from '../jobs'

/**
 * Fila `servicedesk-inventory` (S1):
 *
 * - `scan-due` (a cada 5 min) enfileira os alvos SNMP cuja hora chegou;
 * - `scan-target` varre um alvo e grava os equipamentos na CMDB.
 *
 * Falha de infraestrutura (banco, Redis) lança para o BullMQ registrar; falha
 * da varredura em si (host mudo, community errada) não lança — fica no
 * `lastStatus`/`lastError` do alvo, que é onde o admin olha.
 */
export async function processServicedeskInventory(
  job: Job<{ targetId?: string }>,
): Promise<unknown> {
  switch (job.name) {
    case ServicedeskInventoryJob.ScanDue: {
      const result = await SdInventoryTargetService.enqueueDue()
      if (!result.ok) {
        throw new Error(
          `servicedesk-inventory scan-due failed: ${result.error.code} ${result.error.message}`,
        )
      }
      logger.info('queue.servicedesk_inventory.due_enqueued', {
        component: 'Worker',
        jobId: job.id,
        enqueued: result.value,
      })
      return { enqueued: result.value }
    }
    case ServicedeskInventoryJob.ScanTarget: {
      const targetId = job.data?.targetId
      if (!targetId) {
        throw new Error(
          `servicedesk-inventory scan-target without targetId (id=${job.id ?? 'unknown'})`,
        )
      }
      const result = await SdInventoryTargetService.runScan(targetId)
      if (!result.ok) {
        throw new Error(
          `servicedesk-inventory scan failed: ${result.error.code} ${result.error.message}`,
        )
      }
      logger.info('queue.servicedesk_inventory.scan_completed', {
        component: 'Worker',
        jobId: job.id,
        targetId,
        ...(result.value ?? { skipped: true }),
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown servicedesk-inventory job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
