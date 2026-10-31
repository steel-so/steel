import { logger } from '@/lib/axiom/logger'
import { sdLicenseInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  normalizeSdLicensePattern,
  SD_LICENSE_TIMEZONE,
  sdLicenseDaysLeft,
  sdLicenseExpiryState,
  sdLicenseNoticeKind,
  sdLicenseToday,
} from '@/src/lib/servicedesk/license'
import {
  summarizeSdLicenses,
  toSdConfigItemLicenseDTO,
  toSdLicenseDetailDTO,
  toSdLicenseDTO,
  toSdLicenseInstalledDeviceDTO,
} from '@/src/mappers/sd-license.mapper'
import { SdLicenseRepository } from '@/src/repositories/sd-license.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import type {
  CreateSdLicenseDTO,
  ListSdLicensesQuery,
  SetSdLicenseAssetsDTO,
  UpdateSdLicenseDTO,
} from '@/src/schemas/sd-license.schema'
import type {
  SdConfigItemLicenseDTO,
  SdLicenseDetailDTO,
  SdLicenseDTO,
  SdLicenseListDTO,
} from '@/types/sd-license'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'
import { notifySdUsers } from './sd-notification.service'

/** Equipamentos listados no detalhe de uma licença. */
export const SD_LICENSE_DEVICE_LIMIT = 200

export interface SdLicenseExpiryTickResult {
  workspaces: number
  candidates: number
  notices: number
  expired: number
  /** Já avisadas antes (ou sem aviso a dar). */
  skipped: number
  errors: number
}

async function installedCount(
  workspaceId: string,
  pattern: string,
): Promise<Result<number>> {
  return SdLicenseRepository.countInstalled(workspaceId, pattern)
}

export const SdLicenseService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListSdLicensesQuery,
    now = new Date(),
  ): Promise<Result<SdLicenseListDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const rows = await SdLicenseRepository.list(workspaceId, {
      search: query.search,
      includeArchived: query.includeArchived,
    })
    if (!rows.ok) return rows

    const today = sdLicenseToday(now)
    const items: SdLicenseDTO[] = []
    for (const row of rows.value) {
      const installed = await installedCount(workspaceId, row.matchPattern)
      if (!installed.ok) return installed
      items.push(toSdLicenseDTO(row, installed.value, today))
    }
    const filtered = query.status
      ? items.filter((item) => item.status === query.status)
      : items
    return ok({ items: filtered, summary: summarizeSdLicenses(items) })
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
    now = new Date(),
  ): Promise<Result<SdLicenseDetailDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const row = await SdLicenseRepository.findById(id, workspaceId)
    if (!row.ok) return row
    const installed = await installedCount(workspaceId, row.value.matchPattern)
    if (!installed.ok) return installed
    const devices = await SdLicenseRepository.listInstalledDevices(
      workspaceId,
      row.value.matchPattern,
      SD_LICENSE_DEVICE_LIMIT,
    )
    if (!devices.ok) return devices

    const assigned = new Set(row.value.assignments.map((a) => a.configItemId))
    const deviceDtos = devices.value.map((d) =>
      toSdLicenseInstalledDeviceDTO(d, assigned),
    )
    // Sem licença = total instalado menos os cobertos (a lista pode ser cortada).
    const assignedInstalled = deviceDtos.filter((d) => d.assigned).length
    const unassigned = installed.value - assignedInstalled
    return ok(
      toSdLicenseDetailDTO(
        row.value,
        installed.value,
        deviceDtos,
        unassigned,
        sdLicenseToday(now),
      ),
    )
  },

  async forConfigItem(
    actorId: string,
    workspaceId: string,
    configItemId: string,
    now = new Date(),
  ): Promise<Result<SdConfigItemLicenseDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdLicenseRepository.listForConfigItem(
      workspaceId,
      configItemId,
    )
    if (!rows.ok) return rows
    const today = sdLicenseToday(now)
    return ok(rows.value.map((row) => toSdConfigItemLicenseDTO(row, today)))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdLicenseDTO,
  ): Promise<Result<SdLicenseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_software_license',
      action: 'create',
      targetId: (value) => value.id,
      meta: { seats: dto.seats },
      run: async () => {
        const invalid = validateDates(dto.purchasedAt, dto.expiresAt)
        if (invalid) return err(invalid)
        const created = await SdLicenseRepository.create(workspaceId, actorId, {
          ...dto,
          matchPattern: normalizeSdLicensePattern(dto.matchPattern),
        })
        if (!created.ok) return created
        const row = await SdLicenseRepository.findById(
          created.value.id,
          workspaceId,
        )
        if (!row.ok) return row
        return toDto(workspaceId, row.value)
      },
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateSdLicenseDTO,
  ): Promise<Result<SdLicenseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_software_license',
      action: 'update',
      targetId: id,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const current = await SdLicenseRepository.findById(id, workspaceId)
        if (!current.ok) return current
        const invalid = validateDates(
          dto.purchasedAt === undefined
            ? current.value.purchasedAt
            : dto.purchasedAt,
          dto.expiresAt === undefined ? current.value.expiresAt : dto.expiresAt,
        )
        if (invalid) return err(invalid)

        const data = {
          ...dto,
          ...(dto.matchPattern
            ? { matchPattern: normalizeSdLicensePattern(dto.matchPattern) }
            : {}),
          // Renovou ou mudou a data: os avisos valem de novo.
          ...(dto.expiresAt !== undefined || dto.renewalNoticeDays !== undefined
            ? { lastNoticeKind: null, lastNoticeAt: null }
            : {}),
        }
        const saved = await SdLicenseRepository.update(id, workspaceId, data)
        if (!saved.ok) return saved
        const row = await SdLicenseRepository.findById(id, workspaceId)
        if (!row.ok) return row
        return toDto(workspaceId, row.value)
      },
    })
  },

  /** Arquiva (some das listas e dos avisos); `restore` desfaz. */
  async archive(
    actorId: string,
    workspaceId: string,
    id: string,
    archived = true,
  ): Promise<Result<SdLicenseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_software_license',
      action: archived ? 'archive' : 'restore',
      targetId: id,
      run: async () => {
        const current = await SdLicenseRepository.findById(id, workspaceId)
        if (!current.ok) return current
        const saved = await SdLicenseRepository.update(id, workspaceId, {
          archivedAt: archived ? new Date() : null,
        })
        if (!saved.ok) return saved
        const row = await SdLicenseRepository.findById(id, workspaceId)
        if (!row.ok) return row
        return toDto(workspaceId, row.value)
      },
    })
  },

  async setAssets(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: SetSdLicenseAssetsDTO,
  ): Promise<Result<SdLicenseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_software_license',
      action: 'assign',
      targetId: id,
      meta: { assets: dto.configItemIds.length },
      run: async () => {
        const current = await SdLicenseRepository.findById(id, workspaceId)
        if (!current.ok) return current
        const ids = Array.from(new Set(dto.configItemIds))
        if (ids.length > 0) {
          const found = await SdLicenseRepository.countConfigItems(
            workspaceId,
            ids,
          )
          if (!found.ok) return found
          if (found.value !== ids.length) {
            return err(sdLicenseInvalid('Algum ativo informado não existe'))
          }
        }
        const saved = await SdLicenseRepository.replaceAssets(id, ids)
        if (!saved.ok) return saved
        const row = await SdLicenseRepository.findById(id, workspaceId)
        if (!row.ok) return row
        return toDto(workspaceId, row.value)
      },
    })
  },

  /**
   * Aviso diário de vencimento (`servicedesk-inventory` / `license-expiry`):
   * quem entra na janela de renovação ou vence recebe UM aviso, entregue aos
   * donos e administradores. O carimbo `lastNoticeKind` é reservado antes do
   * envio, então repetir o ciclo não repete a mensagem.
   */
  async runExpiryTick(
    now = new Date(),
  ): Promise<Result<SdLicenseExpiryTickResult>> {
    const result: SdLicenseExpiryTickResult = {
      workspaces: 0,
      candidates: 0,
      notices: 0,
      expired: 0,
      skipped: 0,
      errors: 0,
    }
    const enabled = await SdTicketContextRepository.listEnabledWorkspaceIds()
    if (!enabled.ok) return enabled
    result.workspaces = enabled.value.length

    const rows = await SdLicenseRepository.listWithExpiry(enabled.value)
    if (!rows.ok) return rows
    const today = sdLicenseToday(now, SD_LICENSE_TIMEZONE)

    const admins = new Map<string, string[]>()
    for (const row of rows.value) {
      const daysLeft = sdLicenseDaysLeft(row.expiresAt, today)
      const state = sdLicenseExpiryState(daysLeft, row.renewalNoticeDays)
      const kind = sdLicenseNoticeKind(state, daysLeft)
      if (!kind) {
        result.skipped += 1
        continue
      }
      result.candidates += 1

      const claimed = await SdLicenseRepository.claimNotice(row.id, kind, now)
      if (!claimed.ok) {
        result.errors += 1
        continue
      }
      if (!claimed.value) {
        result.skipped += 1
        continue
      }

      if (!admins.has(row.workspaceId)) {
        const ids = await SdLicenseRepository.listAdminUserIds(row.workspaceId)
        admins.set(row.workspaceId, ids.ok ? ids.value : [])
      }
      const when = kind === 'EXPIRED' ? 'venceu' : daysLabel(daysLeft ?? 0)
      const sent = await notifySdUsers({
        workspaceId: row.workspaceId,
        event: 'license.expiring',
        userIds: admins.get(row.workspaceId) ?? [],
        title:
          kind === 'EXPIRED'
            ? `Licença vencida: ${row.name}`
            : `Licença perto de vencer: ${row.name}`,
        body: `A licença de ${row.name} ${when}. Renove ou atualize a data no ServiceDesk.`,
        hrefFor: (slug) => `/${slug}/servicedesk/licenses`,
        meta: { licenseId: row.id, notice: kind },
      })
      if (!sent.ok) {
        result.errors += 1
        logger.warn('servicedesk.license.notify_failed', {
          workspaceId: row.workspaceId,
          licenseId: row.id,
          reason: sent.error.code,
        })
        continue
      }
      if (kind === 'EXPIRED') result.expired += 1
      else result.notices += 1
    }
    return ok(result)
  },
}

function daysLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'vence hoje'
  if (daysLeft === 1) return 'vence amanhã'
  return `vence em ${daysLeft} dias`
}

function validateDates(
  purchasedAt: Date | null | undefined,
  expiresAt: Date | null | undefined,
) {
  if (purchasedAt && expiresAt && expiresAt.getTime() < purchasedAt.getTime()) {
    return sdLicenseInvalid('O vencimento não pode ser anterior à compra')
  }
  return null
}

async function toDto(
  workspaceId: string,
  row: Parameters<typeof toSdLicenseDTO>[0],
): Promise<Result<SdLicenseDTO>> {
  const installed = await installedCount(workspaceId, row.matchPattern)
  if (!installed.ok) return installed
  return ok(toSdLicenseDTO(row, installed.value, sdLicenseToday(new Date())))
}
