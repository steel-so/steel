import type { WorkspaceAccessLog } from '@prisma/client'
import type { CsvValue } from '@/src/lib/csv-writer'
import type { WorkspaceAccessLogDTO } from '@/types/workspace-access-log'

/** Entry log of IP-restricted workspaces (ADR 0053). */

export const ACCESS_LOG_TIMEZONE = 'America/Sao_Paulo'

export function toWorkspaceAccessLogDTO(
  row: WorkspaceAccessLog,
): WorkspaceAccessLogDTO {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    ip: row.ip,
    userAgent: row.userAgent,
    outcome: row.outcome,
    surface: row.surface,
    path: row.path,
    createdAt: row.createdAt.toISOString(),
  }
}

export const ACCESS_LOG_CSV_HEADER = [
  'Data e hora (São Paulo)',
  'Resultado',
  'Canal',
  'Nome',
  'E-mail',
  'ID do usuário',
  'IP',
  'Caminho',
  'Navegador (user agent)',
]

const OUTCOME_LABEL = { ALLOWED: 'Permitido', BLOCKED: 'Bloqueado' } as const
const SURFACE_LABEL = { APP: 'App', API: 'API' } as const

const timestampFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACCESS_LOG_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** `YYYY-MM-DD HH:mm:ss` in São Paulo (audits want the second). */
export function formatAccessLogTimestamp(at: Date): string {
  return timestampFormatter.format(at).replace(', ', ' ')
}

export function toWorkspaceAccessLogCsvCells(
  row: WorkspaceAccessLog,
): CsvValue[] {
  return [
    formatAccessLogTimestamp(row.createdAt),
    OUTCOME_LABEL[row.outcome],
    SURFACE_LABEL[row.surface],
    row.userName,
    row.userEmail,
    row.userId,
    row.ip,
    row.path,
    row.userAgent,
  ]
}
