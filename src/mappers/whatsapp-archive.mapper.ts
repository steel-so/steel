import type { WhatsAppArchiveSettings } from '@prisma/client'
import {
  archiveFileName,
  resolveArchiveRootFolder,
} from '@/src/lib/whatsapp/archive/layout'
import type { WhatsAppArchiveWithTrigger } from '@/src/repositories/whatsapp-archive.repository'
import type {
  WhatsAppArchiveDTO,
  WhatsAppArchiveSettingsDTO,
} from '@/types/whatsapp-archive'

/** Workspace route (OWNER/ADMIN of the workspace). */
export function whatsappArchiveDownloadPath(
  workspaceId: string,
  archiveId: string,
): string {
  return `/api/workspaces/${workspaceId}/whatsapp/archives/${archiveId}/download`
}

/** Platform admin route (the admin may not be a member). */
export function adminWhatsappArchiveDownloadPath(
  workspaceId: string,
  archiveId: string,
): string {
  return `/api/admin/workspaces/${workspaceId}/whatsapp-archive/${archiveId}/download`
}

export function isWhatsAppArchiveExpired(
  row: Pick<WhatsAppArchiveWithTrigger, 'status' | 'objectKey' | 'expiresAt'>,
  now: Date,
): boolean {
  if (row.status !== 'DONE') return false
  return (
    row.objectKey === null ||
    (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
  )
}

export function isWhatsAppArchiveDownloadable(
  row: Pick<WhatsAppArchiveWithTrigger, 'status' | 'objectKey' | 'expiresAt'>,
  now: Date,
): boolean {
  return row.status === 'DONE' && !isWhatsAppArchiveExpired(row, now)
}

/** `.zip` name: the root folder used at build time, else today's default. */
export function whatsappArchiveFileName(
  row: Pick<
    WhatsAppArchiveWithTrigger,
    'kind' | 'periodStart' | 'periodEnd' | 'rootFolderName'
  >,
  defaultRoot: string,
): string {
  return archiveFileName(row.rootFolderName ?? defaultRoot, row.kind, {
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  })
}

export function toWhatsAppArchiveDTO(
  row: WhatsAppArchiveWithTrigger,
  options: {
    now: Date
    defaultRoot: string
    downloadPath: (workspaceId: string, archiveId: string) => string
  },
): WhatsAppArchiveDTO {
  const downloadable = isWhatsAppArchiveDownloadable(row, options.now)
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd.toISOString(),
    fileName: whatsappArchiveFileName(row, options.defaultRoot),
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    sha256: row.sha256,
    fileCount: row.fileCount,
    atendimentoCount: row.atendimentoCount,
    offsiteCopiedAt: row.offsiteCopiedAt?.toISOString() ?? null,
    error: row.error,
    triggeredBy: row.triggeredBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: isWhatsAppArchiveExpired(row, options.now),
    downloadUrl: downloadable
      ? options.downloadPath(row.workspaceId, row.id)
      : null,
  }
}

export function toWhatsAppArchiveSettingsDTO(
  settings: WhatsAppArchiveSettings | null,
  workspaceSlug: string,
): WhatsAppArchiveSettingsDTO {
  return {
    enabled: settings?.enabled ?? false,
    rootFolderName: settings?.rootFolderName ?? null,
    effectiveRootFolderName: resolveArchiveRootFolder(
      settings?.rootFolderName,
      workspaceSlug,
    ),
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  }
}
