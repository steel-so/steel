import { createHash, randomBytes } from 'node:crypto'
import { auditMutation } from '@/lib/axiom/audit'
import { sdConfigNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { sdMonitorCorrelationKey } from '@/src/lib/servicedesk/monitoring'
import {
  toSdMonitorAlertDTO,
  toSdMonitorSourceDTO,
  toSdMonitorSourceWithTokenDTO,
} from '@/src/mappers/sd-monitor.mapper'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import { SdMonitorAlertRepository } from '@/src/repositories/sd-monitor-alert.repository'
import {
  type SdMonitorSourceData,
  SdMonitorSourceRepository,
} from '@/src/repositories/sd-monitor-source.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import type {
  CreateSdMonitorSourceDTO,
  LinkSdMonitorAlertDTO,
  ListSdMonitorAlertsDTO,
  ListSdMonitorSourcesDTO,
  UpdateSdMonitorSourceDTO,
} from '@/src/schemas/sd-monitor-source.schema'
import type {
  SdMonitorAlertDTO,
  SdMonitorSourceDTO,
  SdMonitorSourceWithTokenDTO,
} from '@/types/sd-monitor'
import { SdAccess } from './sd-access'
import { assertSdRefs, sdAdminMutation } from './sd-config-support'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'

/**
 * Origens de monitoramento (Zabbix, Grafana, PRTG e webhook genérico): CRUD só de admin do
 * módulo, no mesmo molde das demais coleções de configuração.
 *
 * O token da URL pública é sorteado na criação (32 bytes em base64url),
 * mostrado **uma única vez** e guardado apenas como SHA-256 — igual ao link
 * de aprovação por e-mail. Perdeu o token, gere outro (`regenerateToken`):
 * o anterior deixa de valer na hora.
 */

/** Token da URL pública e o hash guardado no banco. */
export function newSdMonitorToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashSdMonitorToken(token) }
}

export function hashSdMonitorToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Confere departamento, categoria, cliente e as prioridades do mapa. */
async function assertRefs(
  workspaceId: string,
  dto: Partial<CreateSdMonitorSourceDTO>,
): Promise<Result<true>> {
  const refs = await assertSdRefs(workspaceId, {
    departmentIds: [dto.departmentId],
    categoryIds: [dto.categoryId],
    priorityIds: (dto.severityMap ?? []).map((entry) => entry.priorityId),
  })
  if (!refs.ok) return refs
  if (!dto.customerId) return ok(true)

  const found = await SdCustomerRepository.findExistingIds(workspaceId, [
    dto.customerId,
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

function toData(
  dto: Partial<CreateSdMonitorSourceDTO>,
): SdMonitorSourceData & { severityMap?: SdMonitorSourceData['severityMap'] } {
  const data: SdMonitorSourceData = {}
  if (dto.name !== undefined) data.name = dto.name
  if (dto.kind !== undefined) data.kind = dto.kind
  if (dto.active !== undefined) data.active = dto.active
  if (dto.ticketType !== undefined) data.ticketType = dto.ticketType
  if (dto.departmentId !== undefined) data.departmentId = dto.departmentId
  if (dto.categoryId !== undefined) data.categoryId = dto.categoryId
  if (dto.customerId !== undefined) data.customerId = dto.customerId
  if (dto.severityMap !== undefined) data.severityMap = dto.severityMap
  if (dto.autoResolve !== undefined) data.autoResolve = dto.autoResolve
  if (dto.flappingWindowMinutes !== undefined) {
    data.flappingWindowMinutes = dto.flappingWindowMinutes
  }
  if (dto.correlationMode !== undefined) {
    data.correlationMode = dto.correlationMode
  }
  if (dto.correlationWindowMinutes !== undefined) {
    data.correlationWindowMinutes = dto.correlationWindowMinutes
  }
  if (dto.raisePriorityOnCorrelation !== undefined) {
    data.raisePriorityOnCorrelation = dto.raisePriorityOnCorrelation
  }
  return data
}

export const SdMonitorSourceService = {
  /** Agentes consultam (a tela do chamado mostra a origem), admins mantêm. */
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListSdMonitorSourcesDTO = { includeInactive: false },
  ): Promise<Result<SdMonitorSourceDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdMonitorSourceRepository.list(workspaceId, filters)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdMonitorSourceDTO))
  },

  /** Alertas recebidos (origem, chamado ou status). Só agentes. */
  async listAlerts(
    actorId: string,
    workspaceId: string,
    filters: ListSdMonitorAlertsDTO,
  ): Promise<Result<SdMonitorAlertDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdMonitorAlertRepository.list(workspaceId, filters)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdMonitorAlertDTO))
  },

  /**
   * Liga (ou desliga) à mão o item da CMDB de um alerta cujo host não casou.
   * Com `remember`, guarda host → item para os próximos alertas e liga os
   * abertos de agora com o mesmo host. O chamado do alerta herda o item se
   * ainda não tinha um.
   */
  async linkAlert(
    actorId: string,
    workspaceId: string,
    alertId: string,
    dto: LinkSdMonitorAlertDTO,
  ): Promise<Result<SdMonitorAlertDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const alert = await SdMonitorAlertRepository.findById(alertId, workspaceId)
    if (!alert.ok) return alert

    if (dto.configItemId) {
      const exists = await SdMonitorAlertRepository.configItemExists(
        workspaceId,
        dto.configItemId,
      )
      if (!exists.ok) return exists
      if (!exists.value) {
        return err({
          ...sdConfigNotFound(),
          message: 'Item de configuração não encontrado nesta workspace',
        })
      }
    }

    const updated = await SdMonitorAlertRepository.update(alertId, {
      configItemId: dto.configItemId,
      correlationKey: sdMonitorCorrelationKey(
        dto.configItemId,
        alert.value.host,
      ),
    })
    if (!updated.ok) return updated

    let linkedOthers = 0
    if (dto.configItemId && dto.remember && alert.value.host) {
      const saved = await SdMonitorAlertRepository.upsertHostAlias(
        workspaceId,
        alert.value.host,
        dto.configItemId,
        actorId,
      )
      if (!saved.ok) return saved
      const others = await SdMonitorAlertRepository.linkUnmatchedByHost(
        workspaceId,
        alert.value.host,
        dto.configItemId,
      )
      if (!others.ok) return others
      linkedOthers = others.value
    }

    if (dto.configItemId && alert.value.ticketId) {
      const ticket = await SdTicketRepository.findById(
        alert.value.ticketId,
        workspaceId,
      )
      if (ticket.ok && !ticket.value.configItemId) {
        const set = await SdTicketRepository.update(ticket.value.id, {
          configItemId: dto.configItemId,
        })
        if (set.ok) {
          await recordSdTicketEvent({
            workspaceId,
            ticketId: ticket.value.id,
            actorKind: 'AGENT',
            actorUserId: actorId,
            action: 'monitor.config_item_linked',
            meta: { alertId, configItemId: dto.configItemId },
          })
        }
      }
    }

    auditMutation({
      entity: 'sd_monitor_alert',
      action: 'update',
      actorId,
      targetId: alertId,
      meta: {
        workspaceId,
        configItemId: dto.configItemId,
        remember: dto.remember,
        linkedOthers,
      },
    })
    return ok(toSdMonitorAlertDTO(updated.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdMonitorSourceDTO,
  ): Promise<Result<SdMonitorSourceWithTokenDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_monitor_source',
      action: 'create',
      targetId: (value) => value.id,
      meta: { kind: dto.kind },
      run: async () => {
        const refs = await assertRefs(workspaceId, dto)
        if (!refs.ok) return refs
        const { token, hash } = newSdMonitorToken()
        const created = await SdMonitorSourceRepository.create(workspaceId, {
          ...toData(dto),
          name: dto.name,
          tokenHash: hash,
          createdById: actorId,
        })
        if (!created.ok) return created
        return ok(toSdMonitorSourceWithTokenDTO(created.value, token))
      },
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    sourceId: string,
    dto: UpdateSdMonitorSourceDTO,
  ): Promise<Result<SdMonitorSourceDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_monitor_source',
      action: 'update',
      targetId: sourceId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const existing = await SdMonitorSourceRepository.findById(
          sourceId,
          workspaceId,
        )
        if (!existing.ok) return existing
        const refs = await assertRefs(workspaceId, dto)
        if (!refs.ok) return refs
        const updated = await SdMonitorSourceRepository.update(
          sourceId,
          workspaceId,
          toData(dto),
        )
        if (!updated.ok) return updated
        return ok(toSdMonitorSourceDTO(updated.value))
      },
    })
  },

  /** Novo token (o anterior para de funcionar na hora). Mostrado uma vez. */
  async regenerateToken(
    actorId: string,
    workspaceId: string,
    sourceId: string,
  ): Promise<Result<SdMonitorSourceWithTokenDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_monitor_source',
      action: 'update',
      targetId: sourceId,
      meta: { token: 'regenerated' },
      run: async () => {
        const existing = await SdMonitorSourceRepository.findById(
          sourceId,
          workspaceId,
        )
        if (!existing.ok) return existing
        const { token, hash } = newSdMonitorToken()
        const updated = await SdMonitorSourceRepository.update(
          sourceId,
          workspaceId,
          { tokenHash: hash },
        )
        if (!updated.ok) return updated
        return ok(toSdMonitorSourceWithTokenDTO(updated.value, token))
      },
    })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    sourceId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_monitor_source',
      action: 'delete',
      targetId: sourceId,
      run: async () => {
        const existing = await SdMonitorSourceRepository.findById(
          sourceId,
          workspaceId,
        )
        if (!existing.ok) return existing
        return SdMonitorSourceRepository.softDelete(sourceId, workspaceId)
      },
    })
  },
}
