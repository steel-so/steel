import type {
  CrmCompany,
  CrmDuplicateCandidate,
  CrmMergeLog,
  CrmPerson,
} from '@prisma/client'
import type { MergeSnapshot } from '@/src/repositories/crm-duplicate.repository'
import type {
  CrmDuplicateDTO,
  CrmDuplicateReason,
  CrmDuplicateRecordDTO,
  CrmMergeDTO,
} from '@/types/crm-duplicate'

type PersonRow = CrmPerson & { company: { id: string; name: string } | null }

export function personToDuplicateRecord(
  person: PersonRow,
  historyCount: number,
): CrmDuplicateRecordDTO {
  return {
    id: person.id,
    name: person.name,
    emails: person.emails,
    phones: person.phones,
    companyName: person.company?.name ?? null,
    jobTitle: person.jobTitle,
    city: person.city,
    cnpj: null,
    domain: null,
    employees: null,
    createdAt: person.createdAt.toISOString(),
    historyCount,
  }
}

export function companyToDuplicateRecord(
  company: CrmCompany,
  historyCount: number,
): CrmDuplicateRecordDTO {
  return {
    id: company.id,
    name: company.name,
    emails: [],
    phones: [],
    companyName: null,
    jobTitle: null,
    city: null,
    cnpj: company.cnpj,
    domain: company.domain,
    employees: company.employees,
    createdAt: company.createdAt.toISOString(),
    historyCount,
  }
}

export function toCrmDuplicateDTO(
  row: CrmDuplicateCandidate,
  left: CrmDuplicateRecordDTO,
  right: CrmDuplicateRecordDTO,
): CrmDuplicateDTO {
  return {
    id: row.id,
    entity: row.entity,
    score: row.score,
    reasons: row.reasons as CrmDuplicateReason[],
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    left,
    right,
  }
}

export function toCrmMergeDTO(row: CrmMergeLog, now = new Date()): CrmMergeDTO {
  const snapshot = row.snapshot as unknown as Partial<MergeSnapshot> | null
  return {
    id: row.id,
    entity: row.entity,
    survivorId: row.survivorId,
    mergedId: row.mergedId,
    survivorName: snapshot?.names?.survivor ?? '',
    mergedName: snapshot?.names?.merged ?? '',
    createdAt: row.createdAt.toISOString(),
    undoUntil: row.undoUntil.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
    canUndo: !row.undoneAt && row.undoUntil.getTime() > now.getTime(),
  }
}
