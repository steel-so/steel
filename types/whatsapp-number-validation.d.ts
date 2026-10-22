export type WhatsAppNumberValidationStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'

export type WhatsAppNumberValidationScopeDTO =
  | 'CONTACTS'
  | 'BROADCAST'
  | 'AI_CAMPAIGN'
  | 'IMPORT'

/** Progress of a "tem zap?" check. Numbers are never exposed here. */
export interface WhatsAppNumberValidationDTO {
  id: string
  workspaceId: string
  connectionId: string
  scope: WhatsAppNumberValidationScopeDTO
  scopeId: string | null
  status: WhatsAppNumberValidationStatusDTO
  total: number
  processed: number
  withWhatsapp: number
  withoutWhatsapp: number
  /** Contacts the provider could not check (can be tried again). */
  failed: number
  /** Contacts with a recent result, not asked again. */
  cached: number
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

/** What an import returns when the "validar se tem WhatsApp" step was asked. */
export interface WhatsAppImportValidationDTO {
  validation: WhatsAppNumberValidationDTO | null
  /** Why the step did not run (e.g. no Z-API connection); null when it did. */
  validationUnavailable: string | null
}
