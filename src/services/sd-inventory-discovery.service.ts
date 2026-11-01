import type { SdInventoryDiscoveryRange } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { sdInventoryRangeInvalid } from '@/src/errors'
import { ServicedeskInventoryJob } from '@/src/lib/queue/jobs'
import { getServicedeskInventoryQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  createRealDiscoveryDeps,
  type DiscoveredHost,
  type DiscoveryDeps,
  discoverHosts,
} from '@/src/lib/servicedesk/discovery'
import { expandInventoryRanges } from '@/src/lib/servicedesk/inventory'
import { toSdInventoryDiscoveryRangeDTO } from '@/src/mappers/sd-inventory.mapper'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import { SdInventoryDiscoveryRangeRepository } from '@/src/repositories/sd-inventory-discovery-range.repository'
import type {
  CreateSdInventoryDiscoveryRangeDTO,
  UpdateSdInventoryDiscoveryRangeDTO,
} from '@/src/schemas/sd-inventory.schema'
import type { SdInventoryDiscoveryRangeDTO } from '@/types/sd-inventory'
import { assertModuleEnabled } from './authz'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'
import { syncInventoryDevice } from './sd-inventory-sync.service'
import { assertInventoryCustomer } from './sd-inventory-target.service'

const MINUTE_MS = 60_000
/** Reserva da faixa enquanto o job está na fila ou rodando. */
const CLAIM_MINUTES = 60
const DUE_BATCH = 20

export interface SdInventoryDiscoverySummary {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  probed: number
  found: number
  failed: number
}

export interface SdInventoryDiscoveryDeps {
  discovery?: DiscoveryDeps
  now?: Date
}

function failure(message: string): string {
  return message.slice(0, 300)
}

/** Identidade estável: o MAC, senão o IP (DHCP trocando o IP não duplica). */
export function discoveryExternalKey(host: DiscoveredHost): string {
  return host.mac ? `disc:mac:${host.mac}` : `disc:ip:${host.ip}`
}

/**
 * Descoberta por ping + ARP das faixas configuradas (opt-in por faixa).
 * O resultado entra como equipamento "descoberto, sem gestão": não vai para
 * a CMDB até o admin adotar.
 */
export const SdInventoryDiscoveryService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryDiscoveryRangeDTO[]>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdInventoryDiscoveryRangeRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdInventoryDiscoveryRangeDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdInventoryDiscoveryRangeDTO,
  ): Promise<Result<SdInventoryDiscoveryRangeDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_discovery_range',
      action: 'create',
      targetId: (value) => value.id,
      meta: { enabled: dto.enabled },
      run: async () => {
        const customer = await assertInventoryCustomer(
          workspaceId,
          dto.customerId,
        )
        if (!customer.ok) return customer
        const created = await SdInventoryDiscoveryRangeRepository.create({
          workspaceId,
          createdById: actorId,
          name: dto.name,
          cidr: dto.cidr,
          enabled: dto.enabled,
          intervalMinutes: dto.intervalMinutes,
          customerId: dto.customerId ?? null,
          nextRunAt: dto.enabled ? new Date() : null,
        })
        if (!created.ok) return created
        return ok(toSdInventoryDiscoveryRangeDTO(created.value))
      },
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    rangeId: string,
    dto: UpdateSdInventoryDiscoveryRangeDTO,
  ): Promise<Result<SdInventoryDiscoveryRangeDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_discovery_range',
      action: 'update',
      targetId: rangeId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const existing = await SdInventoryDiscoveryRangeRepository.findById(
          rangeId,
          workspaceId,
        )
        if (!existing.ok) return existing
        const customer = await assertInventoryCustomer(
          workspaceId,
          dto.customerId,
        )
        if (!customer.ok) return customer
        const turningOn = dto.enabled === true && !existing.value.enabled
        const updated = await SdInventoryDiscoveryRangeRepository.update(
          rangeId,
          workspaceId,
          { ...dto, ...(turningOn ? { nextRunAt: new Date() } : {}) },
        )
        if (!updated.ok) return updated
        return ok(toSdInventoryDiscoveryRangeDTO(updated.value))
      },
    })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    rangeId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_discovery_range',
      action: 'delete',
      targetId: rangeId,
      run: async () => {
        const existing = await SdInventoryDiscoveryRangeRepository.findById(
          rangeId,
          workspaceId,
        )
        if (!existing.ok) return existing
        return SdInventoryDiscoveryRangeRepository.softDelete(
          rangeId,
          workspaceId,
        )
      },
    })
  },

  /** "Varrer agora": só faixas com o opt-in ligado. */
  async scanNow(
    actorId: string,
    workspaceId: string,
    rangeId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_inventory_discovery_range',
      action: 'update',
      targetId: rangeId,
      meta: { scan: 'requested' },
      run: async () => {
        const existing = await SdInventoryDiscoveryRangeRepository.findById(
          rangeId,
          workspaceId,
        )
        if (!existing.ok) return existing
        if (!existing.value.enabled) {
          return err(
            sdInventoryRangeInvalid(
              'Ative a descoberta nesta faixa antes de varrer',
            ),
          )
        }
        await getServicedeskInventoryQueue().add(
          ServicedeskInventoryJob.DiscoveryRange,
          { rangeId },
          { jobId: `discovery-range-${rangeId}` },
        )
        return ok(undefined)
      },
    })
  },

  /** `discovery-due`: reserva e enfileira cada faixa com opt-in vencida. */
  async enqueueDue(now: Date = new Date()): Promise<Result<number>> {
    const due = await SdInventoryDiscoveryRangeRepository.listDue(
      now,
      DUE_BATCH,
    )
    if (!due.ok) return due
    const queue = getServicedeskInventoryQueue()
    let enqueued = 0
    for (const range of due.value) {
      const claimed = await SdInventoryDiscoveryRangeRepository.update(
        range.id,
        range.workspaceId,
        { nextRunAt: new Date(now.getTime() + CLAIM_MINUTES * MINUTE_MS) },
      )
      if (!claimed.ok) {
        logger.warn('servicedesk.inventory.discovery_claim_failed', {
          rangeId: range.id,
          code: claimed.error.code,
        })
        continue
      }
      await queue.add(
        ServicedeskInventoryJob.DiscoveryRange,
        { rangeId: range.id },
        { jobId: `discovery-range-${range.id}` },
      )
      enqueued++
    }
    return ok(enqueued)
  },

  /**
   * `discovery-range`: sonda a faixa, leva os achados para o inventário como
   * "descobertos" e registra o resultado. `ok(null)` quando a faixa sumiu ou
   * o opt-in foi desligado depois de enfileirada.
   */
  async runScan(
    rangeId: string,
    deps: SdInventoryDiscoveryDeps = {},
  ): Promise<Result<SdInventoryDiscoverySummary | null>> {
    const loaded =
      await SdInventoryDiscoveryRangeRepository.findByIdUnscoped(rangeId)
    if (!loaded.ok) return loaded
    const range = loaded.value
    if (!range?.enabled) return ok(null)

    const now = deps.now ?? new Date()
    const record = async (
      summary: SdInventoryDiscoverySummary,
      message: string | null,
    ): Promise<Result<SdInventoryDiscoverySummary>> => {
      const saved = await SdInventoryDiscoveryRangeRepository.markRun(
        range.id,
        {
          lastRunAt: now,
          nextRunAt: new Date(
            now.getTime() + range.intervalMinutes * MINUTE_MS,
          ),
          lastStatus: summary.status,
          lastProbed: summary.probed,
          lastFound: summary.found,
          lastError: message ? failure(message) : null,
        },
      )
      if (!saved.ok) return saved
      return ok(summary)
    }
    const failed = (message: string) =>
      record({ status: 'FAILED', probed: 0, found: 0, failed: 0 }, message)

    const enabled = await assertModuleEnabled(range.workspaceId, 'SERVICE_DESK')
    if (!enabled.ok) return failed('O módulo ServiceDesk está desligado')

    const hosts = expandInventoryRanges([range.cidr])
    if (!hosts.ok) return failed(hosts.message)

    const swept = await discoverHosts(
      hosts.hosts,
      deps.discovery ?? createRealDiscoveryDeps(),
    )

    let found = 0
    let problems = 0
    for (const host of swept.found) {
      const stored = await storeDiscoveredHost(range, host, now)
      if (!stored.ok) {
        problems++
        logger.warn('servicedesk.inventory.discovery_store_failed', {
          rangeId: range.id,
          ip: host.ip,
          code: stored.error.code,
        })
      } else if (stored.value) {
        found++
      }
    }

    const status: SdInventoryDiscoverySummary['status'] =
      problems === 0 ? 'SUCCESS' : found > 0 ? 'PARTIAL' : 'FAILED'
    return record(
      { status, probed: swept.probed, found, failed: problems },
      problems > 0 ? `${problems} endereço(s) com falha ao gravar` : null,
    )
  },
}

/** `true` quando virou (ou atualizou) uma ficha descoberta. */
async function storeDiscoveredHost(
  range: SdInventoryDiscoveryRange,
  host: DiscoveredHost,
  now: Date,
): Promise<Result<boolean>> {
  const known = await SdInventoryDeviceRepository.existsKnownAddress(
    range.workspaceId,
    { ip: host.ip, mac: host.mac },
  )
  if (!known.ok) return known
  // Máquina que o agente ou o SNMP já conhece: nada a descobrir.
  if (known.value) return ok(false)

  const synced = await syncInventoryDevice(
    range.workspaceId,
    range.createdById,
    {
      source: 'DISCOVERY',
      externalKey: discoveryExternalKey(host),
      hostname: host.hostname ?? host.ip,
      osName: null,
      osVersion: null,
      arch: null,
      manufacturer: null,
      model: null,
      serialNumber: null,
      cpuModel: null,
      cpuCores: null,
      ramTotalMb: null,
      ramUsedMb: null,
      ipAddresses: [host.ip],
      macAddresses: host.mac ? [host.mac] : [],
      disks: [],
      software: null,
      snmpTargetId: null,
      customerId: range.customerId,
      managed: false,
      discoveryRangeId: range.id,
    },
    now,
  )
  if (!synced.ok) return synced
  return ok(true)
}
