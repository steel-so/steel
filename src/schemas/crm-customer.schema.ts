import z from 'zod'

/**
 * Clientes (CRM > Fidelizar > Clientes): a calculated view that unites the
 * companies and the people with at least one WON opportunity. There is no
 * customer entity: every figure is derived from the won deals.
 */

export const CRM_CUSTOMER_KINDS = ['ALL', 'COMPANY', 'PERSON'] as const
export type CrmCustomerKind = (typeof CRM_CUSTOMER_KINDS)[number]

export const CRM_CUSTOMER_SORTS = [
  'name',
  'deals',
  'total',
  'average',
  'firstWonAt',
  'lastWonAt',
  'nextRenewalAt',
] as const
export type CrmCustomerSort = (typeof CRM_CUSTOMER_SORTS)[number]

/** Rows a CSV export may hold. */
export const CRM_CUSTOMER_EXPORT_LIMIT = 50000

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00-03:00`)), {
    message: 'Data inválida',
  })

const Id = z.string().trim().min(1).max(64)

export const CrmCustomerFiltersSchema = z.object({
  kind: z.enum(CRM_CUSTOMER_KINDS).default('ALL'),
  q: z.string().trim().max(120).optional(),
  /** Won between these days (America/Sao_Paulo), both inclusive. */
  wonFrom: Day.optional(),
  wonTo: Day.optional(),
  minTotal: z.coerce.number().min(0).optional(),
  maxTotal: z.coerce.number().min(0).optional(),
  productId: Id.optional(),
  pipelineId: Id.optional(),
  ownerId: Id.optional(),
  hasRenewal: z.enum(['yes', 'no']).optional(),
  /** No won deal for at least N days. */
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(CRM_CUSTOMER_SORTS).default('lastWonAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})
export type CrmCustomerFilters = z.infer<typeof CrmCustomerFiltersSchema>

export const ListCrmCustomersSchema = CrmCustomerFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine(
  (value) =>
    value.minTotal === undefined ||
    value.maxTotal === undefined ||
    value.minTotal <= value.maxTotal,
  {
    message: 'O valor mínimo não pode ser maior que o máximo',
    path: ['minTotal'],
  },
)
export type ListCrmCustomersQuery = z.infer<typeof ListCrmCustomersSchema>

export interface CrmCustomerRowDTO {
  kind: 'COMPANY' | 'PERSON'
  id: string
  name: string
  /** Domain of a company; company name of a person. */
  subtitle: string | null
  deals: number
  totalWon: number
  averageTicket: number
  firstWonAt: string | null
  lastWonAt: string | null
  /** Earliest active contract end still ahead (the company's, for a person). */
  nextRenewalAt: string | null
  ownerId: string | null
  ownerName: string | null
  /** Health of the company (100 = healthy); `null` for people / no score. */
  health: { level: 'LOW' | 'MEDIUM' | 'HIGH'; score: number } | null
}

export interface CrmCustomerTotalsDTO {
  customers: number
  revenue: number
  deals: number
  averageTicket: number
}

export interface CrmCustomersPageDTO {
  items: CrmCustomerRowDTO[]
  total: number
  page: number
  pageSize: number
  totals: CrmCustomerTotalsDTO
}
