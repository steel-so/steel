/**
 * Entry log of IP-restricted workspaces (ADR 0053). Days are civil days in
 * `timezone` (always `America/Sao_Paulo`).
 */

export type WorkspaceAccessOutcomeDTO = 'ALLOWED' | 'BLOCKED'
export type WorkspaceAccessSurfaceDTO = 'APP' | 'API'

export interface WorkspaceAccessLogDTO {
  id: string
  /** Kept after the user is deleted; `null` only if never known. */
  userId: string | null
  /** Snapshot at the time of the attempt. */
  userEmail: string | null
  userName: string | null
  ip: string | null
  userAgent: string | null
  outcome: WorkspaceAccessOutcomeDTO
  surface: WorkspaceAccessSurfaceDTO
  path: string | null
  createdAt: string
}

export interface WorkspaceAccessLogListDTO {
  items: WorkspaceAccessLogDTO[]
  total: number
  page: number
  pageSize: number
  /** First and last day, inclusive (`YYYY-MM-DD`). */
  period: { from: string; to: string; timezone: string }
  /** The workspace allowlist today (empty = no restriction, nothing logged). */
  allowedIps: string[]
}
