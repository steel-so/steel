import type { SdInventorySnmpTarget } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { sdConfigNotFound } from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { ServicedeskInventoryJob } from '@/src/lib/queue/jobs'
import { getServicedeskInventoryQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { expandInventoryRanges } from '@/src/lib/servicedesk/inventory'
import {
  createNetSnmpSession,
  type SnmpHostInfo,
  type SnmpSessionFactory,
  scanSnmpHosts,
} from '@/src/lib/servicedesk/snmp'
import { toSdInventorySnmpTargetDTO } from '@/src/mappers/sd-inventory.mapper'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import { SdInventoryTargetRepository } from '@/src/repositories/sd-inventory-target.repository'
import type {
  CreateSdInventorySnmpTargetDTO,
  UpdateSdInventorySnmpTargetDTO,
} from '@/src/schemas/sd-inventory.schema'
import type { SdInventorySnmpTargetDTO } from '@/types/sd-inventory'
import { assertModuleEnabled } from './authz'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'
import { syncInventoryDevice } from './sd-inventory-sync.service'

const MINUTE_MS = 60_000
/** Reserva do alvo enquanto o `scan-target` está na fila ou rodando. */
const CLAIM_MINUTES = 30
const DUE_BATCH = 50
const SNMP_TIMEOUT_MS = 1500

export interface SdInventoryScanSummary {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  probed: number
  found: number
  failed: number
}

export interface SdInventoryScanDeps {
  factory?: SnmpSessionFactory
  now?: Date
}

async function assertCustomer(
  workspaceId: string,
  customerId: string | null | undefined,
): Promise<Result<true>> {
  if (!customerId) return ok(true)
  const found = await SdCustomerRepository.findExistingIds(workspaceId, [
    customerId,
  ])
  if (!found.ok) return found
  if (found.value.length === 0) {
    return err({
      ...sdConfigNotFound(),
      message: 'Cliente não encontrado nesta workspace',
    })
  }
  return ok(true)
}

/**
 * Identidade estável do equipamento: série, senão o primeiro MAC, senão o IP.
 * Assim o DHCP trocando o IP não duplica o item na CMDB.
 */
export function snmpExternalKey(info: SnmpHostInfo): string {
  if (info.serialNumber) return `snmp:sn:${info.serialNumber.toLowerCase()}`
  if (info.macAddresses[0]) return `snmp:mac:${info.macAddresses[0]}`
  return `snmp:ip:${info.ip}`
}

function failure(message: string): string {
  return message.slice(0, 300)
}

export const SdInventoryTargetService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdInventorySnmpTargetDTO[]>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdInventoryTargetRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdInventorySnmpTargetDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdInventorySnmpTargetDTO,
  ): Promise<Result<SdInventorySnmpTargetDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_target',
      action: 'create',
      targetId: (value) => value.id,
      run: async () => {
        const customer = await assertCustomer(workspaceId, dto.customerId)
        if (!customer.ok) return customer
        const created = await SdInventoryTargetRepository.create({
          workspaceId,
          createdById: actorId,
          name: dto.name,
          ranges: dto.ranges,
          port: dto.port,
          communityEnc: await encryptConnectionSecret(dto.community),
          intervalMinutes: dto.intervalMinutes,
          active: dto.active,
          customerId: dto.customerId ?? null,
          nextRunAt: new Date(),
        })
        if (!created.ok) return created
        return ok(toSdInventorySnmpTargetDTO(created.value))
      },
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    targetId: string,
    dto: UpdateSdInventorySnmpTargetDTO,
  ): Promise<Result<SdInventorySnmpTargetDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_target',
      action: 'update',
      targetId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const existing = await SdInventoryTargetRepository.findById(
          targetId,
          workspaceId,
        )
        if (!existing.ok) return existing
        const customer = await assertCustomer(workspaceId, dto.customerId)
        if (!customer.ok) return customer

        const { community, ...rest } = dto
        const updated = await SdInventoryTargetRepository.update(
          targetId,
          workspaceId,
          {
            ...rest,
            ...(community !== undefined
              ? { communityEnc: await encryptConnectionSecret(community) }
              : {}),
          },
        )
        if (!updated.ok) return updated
        return ok(toSdInventorySnmpTargetDTO(updated.value))
      },
    })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    targetId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_target',
      action: 'delete',
      targetId,
      run: async () => {
        const existing = await SdInventoryTargetRepository.findById(
          targetId,
          workspaceId,
        )
        if (!existing.ok) return existing
        return SdInventoryTargetRepository.softDelete(targetId, workspaceId)
      },
    })
  },

  /** "Varrer agora": enfileira o alvo; o worker faz a varredura. */
  async scanNow(
    actorId: string,
    workspaceId: string,
    targetId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_target',
      action: 'update',
      targetId,
      meta: { scan: 'requested' },
      run: async () => {
        const existing = await SdInventoryTargetRepository.findById(
          targetId,
          workspaceId,
        )
        if (!existing.ok) return existing
        await getServicedeskInventoryQueue().add(
          ServicedeskInventoryJob.ScanTarget,
          { targetId },
          { jobId: `scan-target-${targetId}` },
        )
        return ok(undefined)
      },
    })
  },

  /**
   * `scan-due`: reserva (adia `nextRunAt`) e enfileira cada alvo vencido.
   * A reserva evita enfileirar de novo no tick seguinte enquanto a
   * varredura ainda roda; ao terminar, `runScan` grava a data de verdade.
   */
  async enqueueDue(now: Date = new Date()): Promise<Result<number>> {
    const due = await SdInventoryTargetRepository.listDue(now, DUE_BATCH)
    if (!due.ok) return due
    const queue = getServicedeskInventoryQueue()
    let enqueued = 0
    for (const target of due.value) {
      const claimed = await SdInventoryTargetRepository.update(
        target.id,
        target.workspaceId,
        { nextRunAt: new Date(now.getTime() + CLAIM_MINUTES * MINUTE_MS) },
      )
      if (!claimed.ok) {
        logger.warn('servicedesk.inventory.claim_failed', {
          targetId: target.id,
          code: claimed.error.code,
        })
        continue
      }
      await queue.add(
        ServicedeskInventoryJob.ScanTarget,
        { targetId: target.id },
        { jobId: `scan-target-${target.id}` },
      )
      enqueued++
    }
    return ok(enqueued)
  },

  /**
   * `scan-target`: varre as faixas do alvo, grava cada equipamento achado e
   * registra o resultado. `ok(null)` quando o alvo sumiu ou foi desligado
   * depois de enfileirado.
   */
  async runScan(
    targetId: string,
    deps: SdInventoryScanDeps = {},
  ): Promise<Result<SdInventoryScanSummary | null>> {
    const loaded = await SdInventoryTargetRepository.findByIdUnscoped(targetId)
    if (!loaded.ok) return loaded
    const target = loaded.value
    if (!target?.active) return ok(null)

    const now = deps.now ?? new Date()
    const record = async (
      summary: SdInventoryScanSummary,
      message: string | null,
    ): Promise<Result<SdInventoryScanSummary>> => {
      const saved = await SdInventoryTargetRepository.markRun(target.id, {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + target.intervalMinutes * MINUTE_MS),
        lastStatus: summary.status,
        lastFound: summary.found,
        lastError: message ? failure(message) : null,
      })
      if (!saved.ok) return saved
      return ok(summary)
    }
    const failed = (message: string) =>
      record({ status: 'FAILED', probed: 0, found: 0, failed: 0 }, message)

    const enabled = await assertModuleEnabled(
      target.workspaceId,
      'SERVICE_DESK',
    )
    if (!enabled.ok) return failed('O módulo ServiceDesk está desligado')

    const hosts = expandInventoryRanges(target.ranges)
    if (!hosts.ok) return failed(hosts.message)

    let community: string
    try {
      community = await decryptConnectionSecret(target.communityEnc)
    } catch {
      return failed('Não foi possível ler a community guardada')
    }

    const scan = await scanSnmpHosts(
      hosts.hosts,
      deps.factory ?? createNetSnmpSession,
      { community, port: target.port, timeoutMs: SNMP_TIMEOUT_MS },
    )

    let syncFailures = 0
    for (const info of scan.found) {
      const synced = await syncInventoryDevice(
        target.workspaceId,
        target.createdById,
        toDeviceInput(target, info),
        now,
      )
      if (!synced.ok) {
        syncFailures++
        logger.warn('servicedesk.inventory.snmp_sync_failed', {
          targetId: target.id,
          ip: info.ip,
          code: synced.error.code,
        })
      }
    }

    const problems = scan.failed + syncFailures
    const found = scan.found.length - syncFailures
    const status: SdInventoryScanSummary['status'] =
      problems === 0 ? 'SUCCESS' : found > 0 ? 'PARTIAL' : 'FAILED'
    return record(
      { status, probed: scan.probed, found, failed: problems },
      problems > 0 ? `${problems} endereço(s) com falha na varredura` : null,
    )
  },
}

function toDeviceInput(
  target: SdInventorySnmpTarget,
  info: SnmpHostInfo,
): Parameters<typeof syncInventoryDevice>[2] {
  return {
    source: 'SNMP',
    externalKey: snmpExternalKey(info),
    hostname: info.hostname,
    osName: info.description?.slice(0, 120) ?? null,
    osVersion: null,
    arch: null,
    manufacturer: info.manufacturer,
    model: info.model,
    serialNumber: info.serialNumber,
    cpuModel: null,
    cpuCores: null,
    ramTotalMb: info.ramTotalMb,
    ramUsedMb: info.ramUsedMb,
    ipAddresses: [info.ip],
    macAddresses: info.macAddresses,
    disks: info.disks,
    agentVersion: null,
    software:
      info.software.length > 0
        ? info.software.map((name) => ({
            name: name.slice(0, 255),
            version: '',
            publisher: null,
          }))
        : null,
    tokenId: null,
    snmpTargetId: target.id,
    customerId: target.customerId,
  }
}
