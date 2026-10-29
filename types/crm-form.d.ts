export type CrmFormStatusDTO = 'DRAFT' | 'PUBLISHED'
export type CrmFormActionDTO = 'COMPANY' | 'PERSON' | 'LEAD'
export type CrmFormFieldTypeDTO =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'url'
  | 'date'
export type CrmFormFieldTargetDTO = 'person' | 'company' | 'lead'

export interface CrmFormFieldMapping {
  target: CrmFormFieldTargetDTO
  attribute: string
}

export interface CrmFormFieldOption {
  label: string
  value: string
}

export interface CrmFormFieldDefinition {
  key: string
  label: string
  type: CrmFormFieldTypeDTO
  required: boolean
  placeholder?: string
  options?: CrmFormFieldOption[]
  mapping: CrmFormFieldMapping
  phaseId?: string
}

export interface CrmFormPhase {
  id: string
  title: string
  description?: string
}

export interface CrmFormDTO {
  id: string
  name: string
  description: string | null
  status: CrmFormStatusDTO
  publicToken: string
  action: CrmFormActionDTO
  fields: CrmFormFieldDefinition[]
  phases: CrmFormPhase[]
  successMessage: string | null
  redirectUrl: string | null
  submissionCount: number
  /** Newsletter the consent box subscribes to (ADR 0054). */
  newsletterId: string | null
  workspaceId: string
  createdById: string
  updatedById: string | null
  position: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CrmFormPublicDTO {
  id: string
  name: string
  description: string | null
  fields: CrmFormFieldDefinition[]
  phases: CrmFormPhase[]
  successMessage: string | null
  redirectUrl: string | null
  /** Set when the form subscribes to a newsletter: the public form shows
   * an optional consent box with this text (ADR 0054). */
  newsletter?: { name: string; consentText: string } | null
}

export interface CrmFormSubmissionDTO {
  id: string
  formId: string
  values: Record<string, string | boolean>
  action: CrmFormActionDTO
  createdPersonId: string | null
  createdCompanyId: string | null
  createdLeadId: string | null
  referrer: string | null
  createdAt: string
}
