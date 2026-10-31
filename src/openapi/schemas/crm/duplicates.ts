import { z } from 'zod'
import { dto } from '../../common'

/** DTOs de duplicados e mesclagem (`types/crm-duplicate.d.ts`). */

const Entity = z.enum(['PERSON', 'COMPANY'])

export const CrmDuplicateRecordDTO = dto(
  'CrmDuplicateRecord',
  z.object({
    id: z.string(),
    name: z.string(),
    emails: z.array(z.string()),
    phones: z.array(z.string()),
    companyName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    city: z.string().nullable(),
    cnpj: z.string().nullable(),
    domain: z.string().nullable(),
    employees: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    historyCount: z.number().int().meta({
      description:
        'Notas, tarefas e oportunidades que acompanham o registro numa mesclagem.',
    }),
  }),
)

export const CrmDuplicateDTO = dto(
  'CrmDuplicate',
  z.object({
    id: z.string(),
    entity: Entity,
    score: z.number().int().meta({ description: 'De 0 a 100.' }),
    reasons: z.array(z.enum(['email', 'phone', 'name', 'cnpj', 'domain'])),
    status: z.enum(['PENDING', 'MERGED', 'DISMISSED']),
    detectedAt: z.iso.datetime(),
    left: CrmDuplicateRecordDTO,
    right: CrmDuplicateRecordDTO,
  }),
)

export const CrmDuplicatePageDTO = dto(
  'CrmDuplicatePage',
  z.object({
    items: z.array(CrmDuplicateDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pending: z.object({
      person: z.number().int(),
      company: z.number().int(),
    }),
  }),
)

export const CrmMergeDTO = dto(
  'CrmMerge',
  z.object({
    id: z.string(),
    entity: Entity,
    survivorId: z.string(),
    mergedId: z.string(),
    survivorName: z.string(),
    mergedName: z.string(),
    createdAt: z.iso.datetime(),
    undoUntil: z.iso.datetime(),
    undoneAt: z.iso.datetime().nullable(),
    canUndo: z.boolean(),
  }),
)

export const CrmDuplicateScanDTO = dto(
  'CrmDuplicateScan',
  z.object({
    person: z.object({ pairs: z.number().int(), created: z.number().int() }),
    company: z.object({ pairs: z.number().int(), created: z.number().int() }),
  }),
)
