import { auditMutation } from '@/lib/axiom/audit'
import {
  sdMaintenanceClosed,
  sdMaintenanceInvalid,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  SD_STATUS_MAINTENANCE_HISTORY_DAYS,
  SD_STATUS_MAINTENANCE_MAX_DAYS,
} from '@/src/lib/servicedesk/status-maintenance'
import { enqueueSdMaintenanceNotice } from '@/src/lib/servicedesk/status-notify-queue'
import {
  toSdStatusComponentDTO,
  toSdStatusMaintenanceDTO,
} from '@/src/mappers/sd-status-maintenance.mapper'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdStatusComponentRepository } from '@/src/repositories/sd-status-component.repository'
import {
  SdStatusMaintenanceRepository,
  type SdStatusMaintenanceRow,
} from '@/src/repositories/sd-status-maintenance.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import type {
  CreateSdMaintenanceInput,
  CreateSdStatusComponentInput,
  UpdateSdMaintenanceInput,
  UpdateSdStatusComponentInput,
} from '@/src/schemas/sd-status-maintenance.schema'
import type {
  SdStatusComponentDTO,
  SdStatusComponentListDTO,
  SdStatusMaintenanceDTO,
  SdStatusMaintenanceListDTO,
} from '@/types/sd-status-maintenance'
import { SdAccess } from './sd-access'

/**
 * Per-service components of a status page and its scheduled maintenance
 * windows. Reading is for agents; changing a component state, scheduling and
 * canceling a window is for agents with edit rights (they run incidents);
 * creating, renaming and removing components is for the ServiceDesk admin,
 * like the page itself.
 */

const DAY_MS = 86_400_000

async function agentEdit(actorId: string, workspaceId: string) {
  return SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action: 'EDIT',
  })
}

async function agentView(actorId: string, workspaceId: string) {
  return SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action: 'VIEW',
  })
}

async function checkService(
  workspaceId: string,
  serviceId: string,
): Promise<Result<true>> {
  const names = await SdStatusPageRepository.findNames(workspaceId, {
    serviceIds: [serviceId],
    customerId: null,
  })
  if (!names.ok) return names
  if (!names.value.services.has(serviceId)) {
    return err(validationError('Serviço inexistente neste workspace'))
  }
  return ok(true)
}

async function checkPages(
  workspaceId: string,
  pageIds: string[],
): Promise<Result<string[]>> {
  const unique = Array.from(new Set(pageIds))
  const count = await SdMajorIncidentRepository.countPages(workspaceId, unique)
  if (!count.ok) return count
  if (count.value !== unique.length) {
    return err(validationError('Página de status inexistente neste workspace'))
  }
  return ok(unique)
}

async function checkConfigItems(
  workspaceId: string,
  ids: string[],
): Promise<Result<string[]>> {
  const unique = Array.from(new Set(ids))
  const names = await SdStatusMaintenanceRepository.findConfigItemNames(
    workspaceId,
    unique,
  )
  if (!names.ok) return names
  if (names.value.size !== unique.length) {
    return err(validationError('Item da CMDB inexistente neste workspace'))
  }
  return ok(unique)
}

function checkWindow(
  startsAt: Date,
  endsAt: Date,
  suppressMonitoring: boolean,
  configItemIds: string[],
): Result<true> {
  if (endsAt.getTime() <= startsAt.getTime()) {
    return err(sdMaintenanceInvalid('O término precisa ser depois do início'))
  }
  if (
    endsAt.getTime() - startsAt.getTime() >
    SD_STATUS_MAINTENANCE_MAX_DAYS * DAY_MS
  ) {
    return err(
      sdMaintenanceInvalid(
        `A janela pode durar no máximo ${SD_STATUS_MAINTENANCE_MAX_DAYS} dias`,
      ),
    )
  }
  if (suppressMonitoring && configItemIds.length === 0) {
    return err(
      sdMaintenanceInvalid(
        'Para suprimir chamados do monitoramento, escolha os itens da CMDB cobertos',
      ),
    )
  }
  return ok(true)
}

async function toDTO(
  row: SdStatusMaintenanceRow,
  now: Date,
): Promise<Result<SdStatusMaintenanceDTO>> {
  const names = await SdStatusMaintenanceRepository.findConfigItemNames(
    row.workspaceId,
    row.configItemIds,
  )
  if (!names.ok) return names
  return ok(toSdStatusMaintenanceDTO(row, names.value, now))
}

export const SdStatusMaintenanceService = {
  // ----- Components ------------------------------------------------------

  async listComponents(
    actorId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<Result<SdStatusComponentListDTO>> {
    const access = await agentView(actorId, workspaceId)
    if (!access.ok) return access
    const page = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!page.ok) return page
    const rows = await SdStatusComponentRepository.listByPage(
      pageId,
      workspaceId,
    )
    if (!rows.ok) return rows
    return ok({ items: rows.value.map(toSdStatusComponentDTO) })
  },

  async createComponent(
    actorId: string,
    workspaceId: string,
    pageId: string,
    input: CreateSdStatusComponentInput,
  ): Promise<Result<SdStatusComponentDTO>> {
    const access = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access
    const page = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!page.ok) return page
    if (input.serviceId) {
      const service = await checkService(workspaceId, input.serviceId)
      if (!service.ok) return service
    }
    const created = await SdStatusComponentRepository.create({
      workspaceId,
      pageId,
      name: input.name,
      serviceId: input.serviceId ?? null,
      state: input.state,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'sd_status_component',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, pageId },
    })
    return ok(toSdStatusComponentDTO(created.value))
  },

  /** State alone is an agent action; everything else is the admin's. */
  async updateComponent(
    actorId: string,
    workspaceId: string,
    pageId: string,
    componentId: string,
    input: UpdateSdStatusComponentInput,
  ): Promise<Result<SdStatusComponentDTO>> {
    const stateOnly = Object.keys(input).every((key) => key === 'state')
    const access = stateOnly
      ? await agentEdit(actorId, workspaceId)
      : await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access
    if (input.serviceId) {
      const service = await checkService(workspaceId, input.serviceId)
      if (!service.ok) return service
    }
    const updated = await SdStatusComponentRepository.update(
      componentId,
      pageId,
      workspaceId,
      input,
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'sd_status_component',
      action: 'update',
      actorId,
      targetId: componentId,
      meta: { workspaceId, pageId, fields: Object.keys(input) },
    })
    return ok(toSdStatusComponentDTO(updated.value))
  },

  async removeComponent(
    actorId: string,
    workspaceId: string,
    pageId: string,
    componentId: string,
  ): Promise<Result<true>> {
    const access = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access
    const removed = await SdStatusComponentRepository.remove(
      componentId,
      pageId,
      workspaceId,
    )
    if (!removed.ok) return removed
    auditMutation({
      entity: 'sd_status_component',
      action: 'delete',
      actorId,
      targetId: componentId,
      meta: { workspaceId, pageId },
    })
    return ok(true)
  },

  // ----- Maintenance windows ----------------------------------------------

  async listMaintenances(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdStatusMaintenanceListDTO>> {
    const access = await agentView(actorId, workspaceId)
    if (!access.ok) return access
    const now = new Date()
    const rows = await SdStatusMaintenanceRepository.list(
      workspaceId,
      new Date(now.getTime() - SD_STATUS_MAINTENANCE_HISTORY_DAYS * DAY_MS),
    )
    if (!rows.ok) return rows
    const names = await SdStatusMaintenanceRepository.findConfigItemNames(
      workspaceId,
      Array.from(new Set(rows.value.flatMap((row) => row.configItemIds))),
    )
    if (!names.ok) return names
    return ok({
      items: rows.value.map((row) =>
        toSdStatusMaintenanceDTO(row, names.value, now),
      ),
    })
  },

  async createMaintenance(
    actorId: string,
    workspaceId: string,
    input: CreateSdMaintenanceInput,
  ): Promise<Result<SdStatusMaintenanceDTO>> {
    const access = await agentEdit(actorId, workspaceId)
    if (!access.ok) return access
    const now = new Date()
    const valid = checkWindow(
      input.startsAt,
      input.endsAt,
      input.suppressMonitoring,
      input.configItemIds,
    )
    if (!valid.ok) return valid
    if (input.endsAt.getTime() <= now.getTime()) {
      return err(sdMaintenanceInvalid('A janela precisa terminar no futuro'))
    }
    const pageIds = await checkPages(workspaceId, input.pageIds)
    if (!pageIds.ok) return pageIds
    const configItemIds = await checkConfigItems(
      workspaceId,
      input.configItemIds,
    )
    if (!configItemIds.ok) return configItemIds

    const created = await SdStatusMaintenanceRepository.create(workspaceId, {
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      suppressMonitoring: input.suppressMonitoring,
      notifySubscribers: input.notifySubscribers,
      configItemIds: configItemIds.value,
      pageIds: pageIds.value,
      createdById: actorId,
    })
    if (!created.ok) return created
    if (created.value.notifySubscribers) {
      await enqueueSdMaintenanceNotice(created.value.id, 'scheduled')
    }
    auditMutation({
      entity: 'sd_status_maintenance',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        pages: pageIds.value.length,
        suppressMonitoring: input.suppressMonitoring,
      },
    })
    return toDTO(created.value, now)
  },

  async updateMaintenance(
    actorId: string,
    workspaceId: string,
    maintenanceId: string,
    input: UpdateSdMaintenanceInput,
  ): Promise<Result<SdStatusMaintenanceDTO>> {
    const access = await agentEdit(actorId, workspaceId)
    if (!access.ok) return access
    const current = await SdStatusMaintenanceRepository.findById(
      maintenanceId,
      workspaceId,
    )
    if (!current.ok) return current
    const now = new Date()
    if (current.value.canceledAt || current.value.endsAt <= now) {
      return err(sdMaintenanceClosed())
    }

    const startsAt = input.startsAt ?? current.value.startsAt
    const endsAt = input.endsAt ?? current.value.endsAt
    const suppressMonitoring =
      input.suppressMonitoring ?? current.value.suppressMonitoring
    const configItems = input.configItemIds ?? current.value.configItemIds
    const valid = checkWindow(startsAt, endsAt, suppressMonitoring, configItems)
    if (!valid.ok) return valid
    if (endsAt.getTime() <= now.getTime()) {
      return err(sdMaintenanceInvalid('A janela precisa terminar no futuro'))
    }
    let pageIds: string[] | undefined
    if (input.pageIds) {
      const checked = await checkPages(workspaceId, input.pageIds)
      if (!checked.ok) return checked
      pageIds = checked.value
    }
    let configItemIds: string[] | undefined
    if (input.configItemIds) {
      const checked = await checkConfigItems(workspaceId, input.configItemIds)
      if (!checked.ok) return checked
      configItemIds = checked.value
    }

    const rescheduled =
      startsAt.getTime() !== current.value.startsAt.getTime() ||
      endsAt.getTime() !== current.value.endsAt.getTime()
    const renotify =
      rescheduled &&
      current.value.announcedAt !== null &&
      (input.notifySubscribers ?? current.value.notifySubscribers)

    const { pageIds: _pages, configItemIds: _items, ...fields } = input
    const updated = await SdStatusMaintenanceRepository.update(
      maintenanceId,
      workspaceId,
      {
        ...fields,
        ...(pageIds ? { pageIds } : {}),
        ...(configItemIds ? { configItemIds } : {}),
        resetAnnouncement: renotify,
      },
    )
    if (!updated.ok) return updated
    if (renotify) {
      await enqueueSdMaintenanceNotice(maintenanceId, 'rescheduled')
    }
    auditMutation({
      entity: 'sd_status_maintenance',
      action: 'update',
      actorId,
      targetId: maintenanceId,
      meta: { workspaceId, fields: Object.keys(input), rescheduled },
    })
    return toDTO(updated.value, now)
  },

  /** Cancels the window; subscribers who heard about it hear about this too. */
  async cancelMaintenance(
    actorId: string,
    workspaceId: string,
    maintenanceId: string,
  ): Promise<Result<SdStatusMaintenanceDTO>> {
    const access = await agentEdit(actorId, workspaceId)
    if (!access.ok) return access
    const current = await SdStatusMaintenanceRepository.findById(
      maintenanceId,
      workspaceId,
    )
    if (!current.ok) return current
    const now = new Date()
    if (current.value.canceledAt || current.value.endsAt <= now) {
      return err(sdMaintenanceClosed())
    }
    const canceled = await SdStatusMaintenanceRepository.cancel(
      maintenanceId,
      workspaceId,
      now,
    )
    if (!canceled.ok) return canceled
    if (canceled.value.notifySubscribers && canceled.value.announcedAt) {
      await enqueueSdMaintenanceNotice(maintenanceId, 'canceled')
    }
    auditMutation({
      entity: 'sd_status_maintenance',
      action: 'cancel',
      actorId,
      targetId: maintenanceId,
      meta: { workspaceId },
    })
    return toDTO(canceled.value, now)
  },
}
