import z from 'zod'
import {
  APOLLO_EMAIL_STATUSES,
  APOLLO_EMPLOYEE_RANGES,
  APOLLO_MAX_IMPORT,
  APOLLO_MAX_PAGES,
  APOLLO_MAX_PER_PAGE,
  APOLLO_SENIORITIES,
} from '@/src/lib/integrations/apollo'

/**
 * Apollo.io lead import: the connection (API key goes in, never comes back),
 * the search filters, the preview pagination and the import request.
 */

const tag = z.string().trim().min(1).max(120)
const tags = z.array(tag).max(30).default([])

const SENIORITY_VALUES = APOLLO_SENIORITIES.map((s) => s.value) as [
  string,
  ...string[],
]
const RANGE_VALUES = APOLLO_EMPLOYEE_RANGES.map((s) => s.value) as [
  string,
  ...string[],
]
const EMAIL_STATUS_VALUES = APOLLO_EMAIL_STATUSES.map((s) => s.value) as [
  string,
  ...string[],
]

export const ApolloSearchFiltersSchema = z.object({
  personTitles: tags,
  includeSimilarTitles: z.boolean().default(true),
  seniorities: z.array(z.enum(SENIORITY_VALUES)).default([]),
  personLocations: tags,
  organizationLocations: tags,
  organizationDomains: tags,
  employeeRanges: z.array(z.enum(RANGE_VALUES)).default([]),
  keywords: z.string().trim().max(200).default(''),
  emailStatuses: z.array(z.enum(EMAIL_STATUS_VALUES)).default([]),
})
export type ApolloSearchFiltersDTO = z.infer<typeof ApolloSearchFiltersSchema>

/** A search with no filter at all would just list Apollo's whole base. */
export function hasApolloFilters(filters: ApolloSearchFiltersDTO): boolean {
  return (
    filters.personTitles.length > 0 ||
    filters.seniorities.length > 0 ||
    filters.personLocations.length > 0 ||
    filters.organizationLocations.length > 0 ||
    filters.organizationDomains.length > 0 ||
    filters.employeeRanges.length > 0 ||
    filters.keywords.length > 0
  )
}

export const ConnectApolloSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, 'Informe a chave de API da Apollo')
    .max(200, 'Chave muito longa')
    .regex(/^\S+$/, 'A chave não pode ter espaços'),
})
export type ConnectApolloDTO = z.infer<typeof ConnectApolloSchema>

export const UpdateApolloSettingsSchema = z.object({
  defaultMailingListId: z.string().min(1).max(64).nullable(),
})
export type UpdateApolloSettingsDTO = z.infer<typeof UpdateApolloSettingsSchema>

const pageField = z.number().int().min(1).max(APOLLO_MAX_PAGES).default(1)
const perPageField = z
  .number()
  .int()
  .min(1)
  .max(APOLLO_MAX_PER_PAGE)
  .default(25)

export const ApolloSearchSchema = z.object({
  filters: ApolloSearchFiltersSchema,
  page: pageField,
  perPage: perPageField,
})
export type ApolloSearchDTO = z.infer<typeof ApolloSearchSchema>

export const ApolloListContactsSchema = z.object({
  page: pageField,
  perPage: perPageField,
})
export type ApolloListContactsDTO = z.infer<typeof ApolloListContactsSchema>

const opt = (max: number) => z.string().trim().max(max).nullish()

export const ApolloImportContactSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().max(200).default(''),
  email: opt(254),
  emailStatus: opt(40),
  title: opt(200),
  organizationName: opt(200),
  linkedinUrl: opt(300),
  city: opt(100),
})
export type ApolloImportContactDTO = z.infer<typeof ApolloImportContactSchema>

const importBase = {
  mailingListId: z.string().min(1).max(64).nullish(),
}

export const CreateApolloImportSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('SEARCH'),
    filters: ApolloSearchFiltersSchema,
    /** Apollo person ids picked in the preview. */
    apolloIds: z
      .array(z.string().min(1).max(64))
      .min(1, 'Selecione ao menos uma pessoa')
      .max(
        APOLLO_MAX_IMPORT,
        `No máximo ${APOLLO_MAX_IMPORT} pessoas por importação`,
      ),
    ...importBase,
  }),
  z.object({
    source: z.literal('LIST'),
    labelId: z.string().min(1).max(64),
    labelName: z.string().max(200).optional(),
    /**
     * Saved contacts picked in the preview. They already carry their e-mail,
     * so the import never calls the enrichment endpoint (0 credits).
     */
    contacts: z
      .array(ApolloImportContactSchema)
      .min(1, 'Selecione ao menos um contato')
      .max(
        APOLLO_MAX_IMPORT,
        `No máximo ${APOLLO_MAX_IMPORT} contatos por importação`,
      ),
    ...importBase,
  }),
])
export type CreateApolloImportDTO = z.infer<typeof CreateApolloImportSchema>

export const ListApolloImportsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type ListApolloImportsDTO = z.infer<typeof ListApolloImportsSchema>
