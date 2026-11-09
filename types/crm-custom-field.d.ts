export type CrmCustomFieldEntityDTO =
  | 'COMPANY'
  | 'PERSON'
  | 'OPPORTUNITY'
  | 'WHATSAPP_CONTACT'
export type CrmCustomFieldTypeDTO =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'CPF'
  | 'CNPJ'
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'CEP'

export interface CrmCustomFieldDefinitionDTO {
  id: string
  workspaceId: string
  entity: CrmCustomFieldEntityDTO
  key: string
  label: string
  type: CrmCustomFieldTypeDTO
  options: string[]
  required: boolean
  position: number
  createdById: string
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export type CrmCustomFieldValue = string | number | boolean | null

export interface CrmCustomFieldValueDTO {
  id: string
  definitionId: string
  recordId: string
  value: CrmCustomFieldValue
  createdAt: string
  updatedAt: string
}
