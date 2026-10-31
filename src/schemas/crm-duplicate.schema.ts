import { z } from 'zod'

export const CrmDuplicateEntitySchema = z.enum(['PERSON', 'COMPANY'])
export const CrmDuplicateStatusSchema = z.enum([
  'PENDING',
  'MERGED',
  'DISMISSED',
])

export const ListCrmDuplicatesSchema = z.object({
  entity: CrmDuplicateEntitySchema.default('PERSON'),
  status: CrmDuplicateStatusSchema.default('PENDING'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
export type ListCrmDuplicatesDTO = z.infer<typeof ListCrmDuplicatesSchema>

export const ScanCrmDuplicatesSchema = z.object({
  entity: CrmDuplicateEntitySchema.optional(),
})
export type ScanCrmDuplicatesDTO = z.infer<typeof ScanCrmDuplicatesSchema>

/** `survivorId` must be one of the two records of the pair. */
export const MergeCrmDuplicateSchema = z.object({
  survivorId: z.string().trim().min(1, 'Escolha o registro que será mantido'),
})
export type MergeCrmDuplicateDTO = z.infer<typeof MergeCrmDuplicateSchema>

export const ListCrmMergesSchema = z.object({
  entity: CrmDuplicateEntitySchema.default('PERSON'),
})
export type ListCrmMergesDTO = z.infer<typeof ListCrmMergesSchema>
