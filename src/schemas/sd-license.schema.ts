import z from 'zod'
import { booleanQuery, sdId } from './sd-config.schema'

/** Gestão de licenças de software (S7). */

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

/** Data de calendário `YYYY-MM-DD` (ou ISO completo) → `Date` em UTC. */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Data inválida')
  .transform((v) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Data inválida')

const optionalDate = calendarDate.optional().nullable()

export const SdLicenseStatusEnum = z.enum([
  'EXPIRED',
  'UNDER_LICENSED',
  'EXPIRING',
  'OVER_LICENSED',
  'COMPLIANT',
])

const base = {
  name: text(120).min(1, 'Informe o nome da licença'),
  vendor: optionalText(120),
  matchPattern: text(120).min(2, 'Informe parte do nome do software'),
  seats: z.number().int().min(0).max(1_000_000),
  unitCostCents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .optional()
    .nullable(),
  purchasedAt: optionalDate,
  expiresAt: optionalDate,
  renewalNoticeDays: z.number().int().min(0).max(365).default(30),
  notes: optionalText(2000),
}

export const CreateSdLicenseSchema = z.object(base)
export type CreateSdLicenseDTO = z.infer<typeof CreateSdLicenseSchema>

export const UpdateSdLicenseSchema = z
  .object({
    name: base.name,
    vendor: base.vendor,
    matchPattern: base.matchPattern,
    seats: base.seats,
    unitCostCents: base.unitCostCents,
    purchasedAt: base.purchasedAt,
    expiresAt: base.expiresAt,
    renewalNoticeDays: z.number().int().min(0).max(365),
    notes: base.notes,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar')
export type UpdateSdLicenseDTO = z.infer<typeof UpdateSdLicenseSchema>

export const ListSdLicensesQuerySchema = z.object({
  search: text(120).optional(),
  status: SdLicenseStatusEnum.optional(),
  includeArchived: booleanQuery,
})
export type ListSdLicensesQuery = z.infer<typeof ListSdLicensesQuerySchema>

export const SetSdLicenseAssetsSchema = z.object({
  configItemIds: z.array(sdId).max(500),
})
export type SetSdLicenseAssetsDTO = z.infer<typeof SetSdLicenseAssetsSchema>
