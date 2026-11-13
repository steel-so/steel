export interface CrmRetentionSettingsDTO {
  workspaceId: string
  /** A detractor survey answer creates a retention task for the account owner. */
  onDetractor: boolean
  /** A customer-health drop creates a retention task for the account owner. */
  onHealthDrop: boolean
  /** A ServiceDesk SLA breach of a customer creates a task for the account owner. */
  onSlaBreach: boolean
  /** Also open a retention deal next to the task. */
  createOpportunity: boolean
  /** Days until the retention task is due. */
  taskDueDays: number
  /** `true` while the workspace never saved settings (defaults apply). */
  isDefault: boolean
  updatedById: string | null
  updatedAt: string | null
}
