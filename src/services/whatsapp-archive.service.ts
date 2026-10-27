import type { WhatsAppArchiveKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappArchiveDisabled,
  whatsappArchiveInProgress,
  whatsappArchiveNotReady,
} from '@/src/errors'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { WhatsappArchiveRetention } from '@/src/lib/queue/retention'
import { enqueueWhatsappArchiveBuild } from '@/src/lib/queue/whatsapp-archive'
import { err, ok, type Result } from '@/src/lib/result'
import { getOffsiteConfig } from '@/src/lib/storage/offsite-backup'
import {
  archivePeriod,
  defaultArchiveRootFolder,
  WHATSAPP_ARCHIVE_BUCKET,
} from '@/src/lib/whatsapp/archive/layout'
import {
  adminWhatsappArchiveDownloadPath,
  isWhatsAppArchiveDownloadable,
  isWhatsAppArchiveExpired,
  toWhatsAppArchiveDTO,
  toWhatsAppArchiveSettingsDTO,
  whatsappArchiveDownloadPath,
  whatsappArchiveFileName,
} from '@/src/mappers/whatsapp-archive.mapper'
import {
  WhatsAppArchiveRepository,
  type WhatsAppArchiveWithTrigger,
} from '@/src/repositories/whatsapp-archive.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  TriggerWhatsAppArchiveDTO,
  UpdateWhatsAppArchiveSettingsDTO,
} from '@/src/schemas/whatsapp-archive.schema'
import type {
  WhatsAppArchiveDTO,
  WhatsAppArchiveOverviewDTO,
  WhatsAppArchiveSettingsDTO,
} from '@/types/whatsapp-archive'
import { assertModulePrivileged, assertPlatformAdmin } from './authz'

/**
 * WhatsApp archive for banks (ADR 0052). The platform admin turns it on per
 * workspace and can generate a package at once; the weekly and monthly
 * crons queue one package per opted-in workspace; OWNER/ADMIN of the
 * workspace (Comunicação enabled) list and download. Every enable, trigger
 * and download is audited.
 */

export type ArchiveRequestSource = 'admin' | 'schedule' | 'script'

export interface WhatsAppArchiveDownload {
  bucket: string
  key: string
  fileName: string
  sizeBytes: number | null
}

interface Deps {
  now?: Date
}

const RETENTION = {
  weeklyDays: WhatsappArchiveRetention.weeklyDays,
  monthlyMonths: WhatsappArchiveRetention.monthlyFullMonths,
}

async function buildOverview(
  workspaceId: string,
  now: Date,
  downloadPath: (workspaceId: string, archiveId: string) => string,
): Promise<Result<WhatsAppArchiveOverviewDTO>> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  const [settings, rows] = await Promise.all([
    WhatsAppArchiveRepository.getSettings(workspaceId),
    WhatsAppArchiveRepository.listByWorkspace(workspaceId),
  ])
  if (!settings.ok) return settings
  if (!rows.ok) return rows

  const settingsDTO = toWhatsAppArchiveSettingsDTO(
    settings.value,
    workspace.value.slug,
  )
  return ok({
    settings: settingsDTO,
    archives: rows.value.map((row) =>
      toWhatsAppArchiveDTO(row, {
        now,
        defaultRoot: settingsDTO.effectiveRootFolderName,
        downloadPath,
      }),
    ),
    retention: RETENTION,
    offsiteConfigured: getOffsiteConfig() !== null,
  })
}

async function resolveDownload(
  workspaceId: string,
  archiveId: string,
  now: Date,
): Promise<
  Result<{ row: WhatsAppArchiveWithTrigger; target: WhatsAppArchiveDownload }>
> {
  const row = await WhatsAppArchiveRepository.findById(archiveId, workspaceId)
  if (!row.ok) return row
  if (!isWhatsAppArchiveDownloadable(row.value, now)) {
    return err(
      whatsappArchiveNotReady(
        isWhatsAppArchiveExpired(row.value, now)
          ? 'Este pacote passou do prazo de guarda e foi apagado.'
          : row.value.status === 'FAILED'
            ? 'A geração deste pacote falhou. Gere um novo.'
            : undefined,
      ),
    )
  }
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  return ok({
    row: row.value,
    target: {
      bucket: WHATSAPP_ARCHIVE_BUCKET,
      key: row.value.objectKey as string,
      fileName: whatsappArchiveFileName(
        row.value,
        defaultArchiveRootFolder(workspace.value.slug),
      ),
      sizeBytes:
        row.value.sizeBytes === null ? null : Number(row.value.sizeBytes),
    },
  })
}

export const WhatsAppArchiveService = {
  /**
   * Queues one package. `schedule` is idempotent per period (a second cron
   * run finds the first package); `admin` and `script` regenerate on demand.
   * Refused while the archive is off or another package of the kind runs.
   */
  async request(input: {
    workspaceId: string
    kind: WhatsAppArchiveKind
    triggeredById: string | null
    source: ArchiveRequestSource
    now?: Date
  }): Promise<
    Result<{ archive: WhatsAppArchiveWithTrigger; created: boolean }>
  > {
    const now = input.now ?? new Date()
    const settings = await WhatsAppArchiveRepository.getSettings(
      input.workspaceId,
    )
    if (!settings.ok) return settings
    if (!settings.value?.enabled) return err(whatsappArchiveDisabled())

    const period = archivePeriod(input.kind, now)
    if (input.source === 'schedule') {
      const existing = await WhatsAppArchiveRepository.findForPeriod(
        input.workspaceId,
        input.kind,
        period.periodEnd,
      )
      if (!existing.ok) return existing
      if (existing.value) {
        const full = await WhatsAppArchiveRepository.findById(existing.value.id)
        if (!full.ok) return full
        return ok({ archive: full.value, created: false })
      }
    }

    const active = await WhatsAppArchiveRepository.findActive(
      input.workspaceId,
      input.kind,
    )
    if (!active.ok) return active
    if (active.value) return err(whatsappArchiveInProgress())

    const created = await WhatsAppArchiveRepository.create({
      workspaceId: input.workspaceId,
      kind: input.kind,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      triggeredById: input.triggeredById,
    })
    if (!created.ok) return created

    try {
      await enqueueWhatsappArchiveBuild(created.value.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await WhatsAppArchiveRepository.markFailed(created.value.id, message)
      logger.error('whatsapp_archive.enqueue_failed', {
        component: 'WhatsAppArchive',
        workspaceId: input.workspaceId,
        archiveId: created.value.id,
        message,
      })
      return err(
        whatsappArchiveNotReady(
          'Não foi possível iniciar a geração agora. Tente de novo em instantes.',
        ),
      )
    }

    auditMutation({
      entity: 'whatsapp_archive',
      action: 'request',
      actorId: input.triggeredById ?? 'system',
      targetId: created.value.id,
      meta: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        source: input.source,
        periodEnd: period.periodEnd.toISOString(),
      },
    })
    logger.info('whatsapp_archive.requested', {
      component: 'WhatsAppArchive',
      workspaceId: input.workspaceId,
      archiveId: created.value.id,
      kind: input.kind,
      source: input.source,
    })
    return ok({ archive: created.value, created: true })
  },

  /** Cron: one package per opted-in workspace; one failure does not stop the rest. */
  async scheduleAll(
    kind: WhatsAppArchiveKind,
    now: Date,
  ): Promise<Result<{ queued: number; skipped: number; failed: number }>> {
    const workspaces = await WhatsAppArchiveRepository.listEnabledWorkspaces()
    if (!workspaces.ok) return workspaces
    let queued = 0
    let skipped = 0
    let failed = 0
    for (const { workspaceId } of workspaces.value) {
      const result = await WhatsAppArchiveService.request({
        workspaceId,
        kind,
        triggeredById: null,
        source: 'schedule',
        now,
      })
      if (!result.ok) {
        failed += 1
        logger.warn('whatsapp_archive.schedule_failed', {
          component: 'WhatsAppArchive',
          workspaceId,
          kind,
          code: result.error.code,
          message: result.error.message,
        })
      } else if (result.value.created) {
        queued += 1
      } else {
        skipped += 1
      }
    }
    return ok({ queued, skipped, failed })
  },

  /** Comunicação › Configurações (OWNER/ADMIN). */
  async overview(
    actorId: string,
    workspaceId: string,
    deps: Deps = {},
  ): Promise<Result<WhatsAppArchiveOverviewDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership
    return buildOverview(
      workspaceId,
      deps.now ?? new Date(),
      whatsappArchiveDownloadPath,
    )
  },

  async authorizeDownload(
    actorId: string,
    workspaceId: string,
    archiveId: string,
    deps: Deps = {},
  ): Promise<Result<WhatsAppArchiveDownload>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership
    const resolved = await resolveDownload(
      workspaceId,
      archiveId,
      deps.now ?? new Date(),
    )
    if (!resolved.ok) return resolved

    auditMutation({
      entity: 'whatsapp_archive',
      action: 'download',
      actorId,
      targetId: archiveId,
      meta: { workspaceId, kind: resolved.value.row.kind, via: 'workspace' },
    })
    return ok(resolved.value.target)
  },

  /** Admin panel › workspace: settings + packages. */
  async adminOverview(
    actorId: string,
    workspaceId: string,
    deps: Deps = {},
  ): Promise<Result<WhatsAppArchiveOverviewDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    return buildOverview(
      workspaceId,
      deps.now ?? new Date(),
      adminWhatsappArchiveDownloadPath,
    )
  },

  async adminUpdateSettings(
    actorId: string,
    workspaceId: string,
    input: UpdateWhatsAppArchiveSettingsDTO,
  ): Promise<Result<WhatsAppArchiveSettingsDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace

    const saved = await WhatsAppArchiveRepository.upsertSettings(workspaceId, {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.rootFolderName !== undefined
        ? { rootFolderName: input.rootFolderName }
        : {}),
      updatedById: admin.value.userId,
    })
    if (!saved.ok) return saved

    await recordAdminAction({
      actor: admin.value,
      action: 'whatsapp_archive.settings',
      audit: { entity: 'whatsapp_archive_settings', action: 'update' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      meta: {
        enabled: saved.value.enabled,
        rootFolderName: saved.value.rootFolderName,
      },
    })
    return ok(toWhatsAppArchiveSettingsDTO(saved.value, workspace.value.slug))
  },

  async adminTrigger(
    actorId: string,
    workspaceId: string,
    input: TriggerWhatsAppArchiveDTO,
    deps: Deps = {},
  ): Promise<Result<WhatsAppArchiveDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace

    const now = deps.now ?? new Date()
    const result = await WhatsAppArchiveService.request({
      workspaceId,
      kind: input.kind,
      triggeredById: admin.value.userId,
      source: 'admin',
      now,
    })
    if (!result.ok) return result

    await recordAdminAction({
      actor: admin.value,
      action: 'whatsapp_archive.requested',
      audit: { entity: 'whatsapp_archive', action: 'request' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      meta: { archiveId: result.value.archive.id, kind: input.kind },
    })
    return ok(
      toWhatsAppArchiveDTO(result.value.archive, {
        now,
        defaultRoot: defaultArchiveRootFolder(workspace.value.slug),
        downloadPath: adminWhatsappArchiveDownloadPath,
      }),
    )
  },

  async adminAuthorizeDownload(
    actorId: string,
    workspaceId: string,
    archiveId: string,
    deps: Deps = {},
  ): Promise<Result<WhatsAppArchiveDownload>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const resolved = await resolveDownload(
      workspaceId,
      archiveId,
      deps.now ?? new Date(),
    )
    if (!resolved.ok) return resolved

    await recordAdminAction({
      actor: admin.value,
      action: 'whatsapp_archive.download',
      audit: { entity: 'whatsapp_archive', action: 'download' },
      targetType: 'workspace',
      targetId: workspaceId,
      meta: { archiveId, kind: resolved.value.row.kind },
    })
    return ok(resolved.value.target)
  },
}
