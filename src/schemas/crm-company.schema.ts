import z from 'zod'
import { clearableText } from '@/src/schemas/clearable.schema'
import { CustomFieldsInputSchema } from '@/src/schemas/crm-custom-field.schema'

const AddressSchema = z
  .object({
    street: z.string().max(200).optional(),
    number: z.string().max(20).optional(),
    complement: z.string().max(100).optional(),
    neighborhood: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(2).optional(),
    zipCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
  })
  .optional()

const SIZES = ['ME', 'EPP', 'DEMAIS'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isoDate = () =>
  z
    .string()
    .regex(ISO_DATE, 'Use o formato AAAA-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Data inválida')

export const CreateCrmCompanySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
  cnpj: z.string().max(20).optional(),
  domain: z.string().max(200).optional(),
  employees: z.number().int().min(0).optional(),
  linkedin: z.string().max(300).optional(),
  address: AddressSchema,
  arr: z.number().min(0).optional(),
  icp: z.boolean().default(false),
  // Registry data (Receita). Filled by the CNPJ lookup when omitted.
  legalName: z.string().max(200).optional(),
  tradeName: z.string().max(200).optional(),
  emails: z.array(z.email().max(200)).max(20).optional(),
  phones: z.array(z.string().max(30)).max(20).optional(),
  cnaeCode: z.string().max(10).optional(),
  cnaeDescription: z.string().max(300).optional(),
  size: z.enum(SIZES).optional(),
  legalNature: z.string().max(150).optional(),
  registrationStatus: z.string().max(60).optional(),
  openedAt: isoDate().optional(),
  shareCapital: z.number().min(0).optional(),
  accountOwnerId: z.string().optional(),
  customFields: CustomFieldsInputSchema.optional(),
})

export type CreateCrmCompanyDTO = z.infer<typeof CreateCrmCompanySchema>

export const UpdateCrmCompanySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
  // Opcionais limpáveis: null (ou '') apaga o valor.
  cnpj: clearableText(20),
  domain: clearableText(200),
  employees: z.number().int().min(0).nullable().optional(),
  linkedin: clearableText(300),
  address: AddressSchema.nullable(),
  arr: z.number().min(0).nullable().optional(),
  icp: z.boolean().optional(),
  legalName: clearableText(200),
  tradeName: clearableText(200),
  emails: z.array(z.email().max(200)).max(20).optional(),
  phones: z.array(z.string().max(30)).max(20).optional(),
  cnaeCode: clearableText(10),
  cnaeDescription: clearableText(300),
  size: z.enum(SIZES).nullable().optional(),
  legalNature: clearableText(150),
  registrationStatus: clearableText(60),
  openedAt: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    isoDate().nullable().optional(),
  ),
  shareCapital: z.number().min(0).nullable().optional(),
  // Nullable: a coluna é limpável na grade (envia null para desvincular).
  accountOwnerId: z.string().nullable().optional(),
  customFields: CustomFieldsInputSchema.optional(),
})

export type UpdateCrmCompanyDTO = z.infer<typeof UpdateCrmCompanySchema>

export const ListCrmCompaniesSchema = z.object({
  icp: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
})

export type ListCrmCompaniesDTO = z.infer<typeof ListCrmCompaniesSchema>

export const ReorderCrmCompaniesSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmCompaniesDTO = z.infer<typeof ReorderCrmCompaniesSchema>
