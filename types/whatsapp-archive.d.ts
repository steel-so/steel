/** WhatsApp archive for banks (ADR 0052). */

export type WhatsAppArchiveKind = 'WEEKLY' | 'MONTHLY_FULL'

export type WhatsAppArchiveStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

export interface WhatsAppArchiveDTO {
  id: string
  kind: WhatsAppArchiveKind
  status: WhatsAppArchiveStatus
  /** Inclusive start (ISO); `null` for MONTHLY_FULL (whole history). */
  periodStart: string | null
  /** Inclusive end (ISO): 23:59:59.999 São Paulo of the last day. */
  periodEnd: string
  /** Name of the `.zip` when downloaded. */
  fileName: string
  sizeBytes: number | null
  /** SHA-256 (hex) of the whole `.zip`. */
  sha256: string | null
  /** Files in the package (PDFs + `INDICE.csv`). */
  fileCount: number
  /** Distinct atendimentos (conversation × day). */
  atendimentoCount: number
  /** When the off-site copy was verified; `null` = only in MinIO. */
  offsiteCopiedAt: string | null
  error: string | null
  triggeredBy: { id: string; name: string; email: string } | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  /** The retention passed and the file was deleted. */
  expired: boolean
  /** Authenticated download route; `null` unless DONE and not expired. */
  downloadUrl: string | null
}

export interface WhatsAppArchiveSettingsDTO {
  enabled: boolean
  /** Custom root folder; `null` = default. */
  rootFolderName: string | null
  /** Root folder actually used (custom or default). */
  effectiveRootFolderName: string
  updatedAt: string | null
}

export interface WhatsAppArchiveOverviewDTO {
  settings: WhatsAppArchiveSettingsDTO
  archives: WhatsAppArchiveDTO[]
  retention: { weeklyDays: number; monthlyMonths: number }
  /** An off-site copy (`BACKUP_OFFSITE_*`) is configured on this server. */
  offsiteConfigured: boolean
}
