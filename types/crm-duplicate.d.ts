export type CrmDuplicateEntity = 'PERSON' | 'COMPANY'
export type CrmDuplicateStatus = 'PENDING' | 'MERGED' | 'DISMISSED'
export type CrmDuplicateReason = 'email' | 'phone' | 'name' | 'cnpj' | 'domain'

/** One side of a duplicate pair, with what the compare view shows. */
export interface CrmDuplicateRecordDTO {
  id: string
  name: string
  emails: string[]
  phones: string[]
  companyName: string | null
  jobTitle: string | null
  city: string | null
  cnpj: string | null
  domain: string | null
  employees: number | null
  createdAt: string
  /** Notes, tasks and deals that follow the record in a merge. */
  historyCount: number
}

export interface CrmDuplicateDTO {
  id: string
  entity: CrmDuplicateEntity
  score: number
  reasons: CrmDuplicateReason[]
  status: CrmDuplicateStatus
  detectedAt: string
  left: CrmDuplicateRecordDTO
  right: CrmDuplicateRecordDTO
}

export interface CrmDuplicatePageDTO {
  items: CrmDuplicateDTO[]
  total: number
  page: number
  pageSize: number
  pending: { person: number; company: number }
}

export interface CrmMergeDTO {
  id: string
  entity: CrmDuplicateEntity
  survivorId: string
  mergedId: string
  survivorName: string
  mergedName: string
  createdAt: string
  undoUntil: string
  undoneAt: string | null
  /** The window is open and the merge was not undone yet. */
  canUndo: boolean
}

export interface CrmDuplicateScanDTO {
  person: { pairs: number; created: number }
  company: { pairs: number; created: number }
}
