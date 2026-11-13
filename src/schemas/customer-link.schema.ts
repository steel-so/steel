import { z } from 'zod'

export const CUSTOMER_LINK_KINDS = [
  'sd-customer',
  'sd-contact',
  'whatsapp-contact',
] as const

export const CustomerLinkKindSchema = z.enum(CUSTOMER_LINK_KINDS)

/** Query of `GET .../customer-links/suggestions`. */
export const CustomerLinkStateQuerySchema = z.object({
  kind: CustomerLinkKindSchema,
  id: z.string().min(1),
})

/** Body of `POST .../customer-links`. `targetId` is the CRM company/person. */
export const LinkCustomerSchema = z.object({
  kind: CustomerLinkKindSchema,
  id: z.string().min(1),
  targetId: z.string().min(1),
})

/** Query of `DELETE .../customer-links`. */
export const UnlinkCustomerQuerySchema = CustomerLinkStateQuerySchema

/**
 * Query of `GET .../customer-links/resolve`: at least one identifier, and
 * only one is used (the first present, in the order below).
 */
export const ResolveCustomerQuerySchema = z
  .object({
    companyId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    sdCustomerId: z.string().min(1).optional(),
    cnpj: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.companyId || v.personId || v.sdCustomerId || v.cnpj || v.phone),
    { message: 'Informe companyId, personId, sdCustomerId, cnpj ou phone' },
  )

export type CustomerLinkKindInput = z.infer<typeof CustomerLinkKindSchema>
export type LinkCustomerDTO = z.infer<typeof LinkCustomerSchema>
export type ResolveCustomerInput = z.infer<typeof ResolveCustomerQuerySchema>
