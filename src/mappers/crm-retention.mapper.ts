import type { CrmRetentionSettings } from '@prisma/client'
import { CRM_RETENTION_DEFAULTS } from '@/src/schemas/crm-retention.schema'
import type { CrmRetentionSettingsDTO } from '@/types/crm-retention'

/** Saved row (or its absence, = defaults) -> DTO. */
export function toCrmRetentionSettingsDTO(
  workspaceId: string,
  settings: CrmRetentionSettings | null,
): CrmRetentionSettingsDTO {
  if (!settings) {
    return {
      workspaceId,
      ...CRM_RETENTION_DEFAULTS,
      isDefault: true,
      updatedById: null,
      updatedAt: null,
    }
  }
  return {
    workspaceId: settings.workspaceId,
    onDetractor: settings.onDetractor,
    onHealthDrop: settings.onHealthDrop,
    createOpportunity: settings.createOpportunity,
    taskDueDays: settings.taskDueDays,
    isDefault: false,
    updatedById: settings.updatedById,
    updatedAt: settings.updatedAt.toISOString(),
  }
}
