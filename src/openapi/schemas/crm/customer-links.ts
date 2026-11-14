import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do cadastro único (`types/customer-link.d.ts`, ADR 0066). */

const Origin = z.enum(['link', 'fallback']).meta({
  description:
    '`link` = vínculo gravado; `fallback` = casamento por CNPJ, nome, e-mail ou telefone.',
})

export const CustomerLinkStateDTO = dto(
  'CustomerLinkState',
  z.object({
    kind: z.enum(['sd-customer', 'sd-contact', 'whatsapp-contact']),
    id: z.string(),
    sourceName: z.string(),
    linked: z
      .object({
        id: z.string(),
        name: z.string(),
        detail: z.string().nullable(),
      })
      .nullable(),
    suggestions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        detail: z.string().nullable(),
        reason: z.string(),
      }),
    ),
  }),
)

export const ResolvedCustomerDTO = dto(
  'ResolvedCustomer',
  z.object({
    company: z
      .object({
        id: z.string(),
        name: z.string(),
        cnpj: z.string().nullable(),
        origin: Origin,
      })
      .nullable(),
    person: z
      .object({
        id: z.string(),
        name: z.string(),
        companyId: z.string().nullable(),
        emails: z.array(z.string()),
        phones: z.array(z.string()),
        origin: Origin,
      })
      .nullable(),
    sdCustomers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        document: z.string().nullable(),
        origin: Origin,
      }),
    ),
    sdContacts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        whatsapp: z.string().nullable(),
        origin: Origin,
      }),
    ),
    whatsappContacts: z.array(
      z.object({
        id: z.string(),
        name: z.string().nullable(),
        waId: z.string(),
        origin: Origin,
      }),
    ),
  }),
)
