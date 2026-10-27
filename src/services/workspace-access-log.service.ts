import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { validationError } from '@/src/errors'
import { CSV_BOM, csvRow } from '@/src/lib/csv-writer'
import {
  addDayKey,
  localDayKey,
  localDayStart,
} from '@/src/lib/productivity/period'
import { err, ok, type Result } from '@/src/lib/result'
import {
  ACCESS_LOG_CSV_HEADER,
  ACCESS_LOG_TIMEZONE,
  toWorkspaceAccessLogCsvCells,
  toWorkspaceAccessLogDTO,
} from '@/src/mappers/workspace-access-log.mapper'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  type WorkspaceAccessLogCursor,
  type WorkspaceAccessLogFilter,
  WorkspaceAccessLogRepository,
} from '@/src/repositories/workspace-access-log.repository'
import {
  DEFAULT_ACCESS_LOG_RANGE_DAYS,
  type WorkspaceAccessLogExportQuery,
  type WorkspaceAccessLogListQuery,
} from '@/src/schemas/workspace-access-log.schema'
import type { WorkspaceAccessLogListDTO } from '@/types/workspace-access-log'
import { assertPlatformAdmin, assertPrivileged } from './authz'

/**
 * Reading and exporting the entry log of IP-restricted workspaces (ADR
 * 0053). Two doors with the same contract: the workspace OWNER/ADMIN
 * (Ajustes › Segurança) and the global admin (admin workspace panel). Days
 * are civil days in São Paulo. IP is personal data: every export is audited.
 */

/** Largest CSV; a bigger range is refused up front (narrow the filters). */
export const ACCESS_LOG_EXPORT_MAX_ROWS = 100_000
/** Rows read per database round trip while streaming the CSV. */
export const ACCESS_LOG_EXPORT_BATCH = 1_000

export interface WorkspaceAccessLogCsvExport {
  filename: string
  rows: number
  chunks: AsyncGenerator<string>
}

type Door = 'workspace' | 'admin'

interface ResolvedRange {
  fromKey: string
  toKey: string
  from: Date
  to: Date
}

/** `from`/`to` (inclusive São Paulo days) → instants; defaults to 30 days. */
export function resolveAccessLogRange(
  query: { from?: string; to?: string },
  now: Date,
): ResolvedRange {
  const toKey =
    query.to ??
    (query.from
      ? maxKey(query.from, localDayKey(now, ACCESS_LOG_TIMEZONE))
      : localDayKey(now, ACCESS_LOG_TIMEZONE))
  const fromKey =
    query.from ?? addDayKey(toKey, -(DEFAULT_ACCESS_LOG_RANGE_DAYS - 1))
  return {
    fromKey,
    toKey,
    from: localDayStart(fromKey, ACCESS_LOG_TIMEZONE),
    to: localDayStart(addDayKey(toKey, 1), ACCESS_LOG_TIMEZONE),
  }
}

function maxKey(a: string, b: string): string {
  return a > b ? a : b
}

function toFilter(
  workspaceId: string,
  query: WorkspaceAccessLogExportQuery,
  range: ResolvedRange,
): WorkspaceAccessLogFilter {
  return {
    workspaceId,
    from: range.from,
    to: range.to,
    outcome: query.outcome,
    surface: query.surface,
    user: query.user,
  }
}

async function authorize(
  door: Door,
  actorId: string,
  workspaceId: string,
): Promise<Result<string[]>> {
  if (door === 'workspace') {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
  } else {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
  }
  // Admin: also tells a missing workspace apart (RESOURCE_NOT_FOUND).
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  return ok(workspace.value.allowedIps)
}

async function list(
  door: Door,
  actorId: string,
  workspaceId: string,
  query: WorkspaceAccessLogListQuery,
  now: Date,
): Promise<Result<WorkspaceAccessLogListDTO>> {
  const allowedIps = await authorize(door, actorId, workspaceId)
  if (!allowedIps.ok) return allowedIps

  const range = resolveAccessLogRange(query, now)
  const page = await WorkspaceAccessLogRepository.listPage(
    toFilter(workspaceId, query, range),
    { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
  )
  if (!page.ok) return page

  return ok({
    items: page.value.rows.map(toWorkspaceAccessLogDTO),
    total: page.value.total,
    page: query.page,
    pageSize: query.pageSize,
    period: {
      from: range.fromKey,
      to: range.toKey,
      timezone: ACCESS_LOG_TIMEZONE,
    },
    allowedIps: allowedIps.value,
  })
}

async function exportCsv(
  door: Door,
  actorId: string,
  workspaceId: string,
  query: WorkspaceAccessLogExportQuery,
  now: Date,
): Promise<Result<WorkspaceAccessLogCsvExport>> {
  const access = await authorize(door, actorId, workspaceId)
  if (!access.ok) return access

  const range = resolveAccessLogRange(query, now)
  const filter = toFilter(workspaceId, query, range)
  const total = await WorkspaceAccessLogRepository.count(filter)
  if (!total.ok) return total
  if (total.value > ACCESS_LOG_EXPORT_MAX_ROWS) {
    return err(
      validationError(
        `O período tem ${total.value} entradas; o limite por arquivo é ${ACCESS_LOG_EXPORT_MAX_ROWS}. Reduza o período ou use os filtros.`,
        { total: total.value, max: ACCESS_LOG_EXPORT_MAX_ROWS },
      ),
    )
  }

  auditMutation({
    entity: 'workspace_access_log',
    action: 'download',
    actorId,
    targetId: workspaceId,
    meta: {
      workspaceId,
      door,
      from: range.fromKey,
      to: range.toKey,
      outcome: query.outcome ?? null,
      surface: query.surface ?? null,
      userFilter: query.user ? 'set' : null,
      rows: total.value,
    },
  })

  async function* chunks(): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(ACCESS_LOG_CSV_HEADER)
    let cursor: WorkspaceAccessLogCursor | undefined
    while (true) {
      const batch = await WorkspaceAccessLogRepository.listBatch(
        filter,
        ACCESS_LOG_EXPORT_BATCH,
        cursor,
      )
      if (!batch.ok) {
        logger.error('workspace.access_log.export_failed', {
          component: 'WorkspaceAccessLog',
          workspaceId,
          message: batch.error.message,
        })
        throw new Error(batch.error.message)
      }
      if (batch.value.length === 0) return
      yield batch.value
        .map((row) => csvRow(toWorkspaceAccessLogCsvCells(row)))
        .join('')
      if (batch.value.length < ACCESS_LOG_EXPORT_BATCH) return
      const last = batch.value[batch.value.length - 1]
      cursor = { createdAt: last.createdAt, id: last.id }
    }
  }

  return ok({
    filename: `acessos-${range.fromKey}_${range.toKey}.csv`,
    rows: total.value,
    chunks: chunks(),
  })
}

export const WorkspaceAccessLogService = {
  /** Ajustes › Segurança: OWNER/ADMIN of the workspace. */
  list(
    actorId: string,
    workspaceId: string,
    query: WorkspaceAccessLogListQuery,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceAccessLogListDTO>> {
    return list('workspace', actorId, workspaceId, query, now)
  },

  exportCsv(
    actorId: string,
    workspaceId: string,
    query: WorkspaceAccessLogExportQuery,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceAccessLogCsvExport>> {
    return exportCsv('workspace', actorId, workspaceId, query, now)
  },

  /** Admin workspace panel: global platform admin only. */
  adminList(
    actorId: string,
    workspaceId: string,
    query: WorkspaceAccessLogListQuery,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceAccessLogListDTO>> {
    return list('admin', actorId, workspaceId, query, now)
  },

  adminExportCsv(
    actorId: string,
    workspaceId: string,
    query: WorkspaceAccessLogExportQuery,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceAccessLogCsvExport>> {
    return exportCsv('admin', actorId, workspaceId, query, now)
  },

  /** Retention (ADR 0053), called by the data-retention job. */
  pruneOlderThan(cutoff: Date): Promise<Result<number>> {
    return WorkspaceAccessLogRepository.deleteOlderThan(cutoff)
  },
}
