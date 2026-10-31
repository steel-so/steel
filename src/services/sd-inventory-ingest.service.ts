import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sdInventoryTokenInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { normalizeMac } from '@/src/lib/servicedesk/inventory'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import type { SdInventoryReportDTO } from '@/src/schemas/sd-inventory.schema'
import type { SdInventoryIngestResultDTO } from '@/types/sd-inventory'
import { assertModuleEnabled } from './authz'
import { syncInventoryDevice } from './sd-inventory-sync.service'
import { hashSdInventoryToken } from './sd-inventory-token.service'

/**
 * Entrada pública do agente (`POST /api/servicedesk/inventory/report`): sem
 * sessão, o token por workspace é o acesso. O relatório já chega validado
 * pelo schema; aqui só se resolve o token → workspace, confere o módulo e
 * grava via {@link syncInventoryDevice}. Nada lança: toda falha vira `Result`.
 */
export const SdInventoryIngestService = {
  async ingest(
    tokenValue: string,
    report: SdInventoryReportDTO,
  ): Promise<Result<SdInventoryIngestResultDTO>> {
    const found = await SdInventoryTokenRepository.findActiveByHash(
      hashSdInventoryToken(tokenValue),
    )
    if (!found.ok) return found
    const token = found.value
    if (!token) return err(sdInventoryTokenInvalid())

    const enabled = await assertModuleEnabled(token.workspaceId, 'SERVICE_DESK')
    if (!enabled.ok) return enabled

    const now = new Date()
    const synced = await syncInventoryDevice(
      token.workspaceId,
      token.createdById,
      {
        source: 'AGENT',
        externalKey: `agent:${report.agentId}`,
        hostname: report.hostname,
        osName: report.os.name,
        osVersion: report.os.version,
        arch: report.os.arch,
        manufacturer: report.hardware.manufacturer ?? null,
        model: report.hardware.model ?? null,
        serialNumber: report.hardware.serialNumber ?? null,
        cpuModel: report.hardware.cpuModel ?? null,
        cpuCores: report.hardware.cpuCores ?? null,
        ramTotalMb: report.hardware.ramTotalMb ?? null,
        ramUsedMb: report.hardware.ramUsedMb ?? null,
        ipAddresses: [...new Set(report.ipAddresses)],
        macAddresses: [
          ...new Set(
            report.macAddresses
              .map(normalizeMac)
              .filter((mac): mac is string => mac !== null),
          ),
        ],
        disks: report.disks,
        agentVersion: report.agentVersion,
        software: report.software.map((item) => ({
          name: item.name,
          version: item.version,
          publisher: item.publisher,
        })),
        tokenId: token.id,
        snmpTargetId: null,
        customerId: null,
      },
      now,
    )
    if (!synced.ok) {
      logger.error('servicedesk.inventory.ingest_failed', {
        workspaceId: token.workspaceId,
        tokenId: token.id,
        code: synced.error.code,
      })
      return synced
    }

    // Falha em carimbar o último uso não derruba um relatório já gravado.
    const touched = await SdInventoryTokenRepository.touch(token.id, now)
    if (!touched.ok) {
      logger.warn('servicedesk.inventory.token_touch_failed', {
        tokenId: token.id,
      })
    }

    if (synced.value.created) {
      auditMutation({
        entity: 'sd_config_item',
        action: 'create',
        actorId: token.createdById,
        targetId: synced.value.configItemId,
        meta: {
          workspaceId: token.workspaceId,
          origin: 'inventory-agent',
          tokenId: token.id,
        },
      })
    }

    return ok({
      deviceId: synced.value.device.id,
      configItemId: synced.value.configItemId,
      created: synced.value.created,
      openedAlerts: synced.value.openedAlerts,
      resolvedAlerts: synced.value.resolvedAlerts,
    })
  },
}
