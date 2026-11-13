/** Which record of the other module a link starts from (ADR 0066). */
export type CustomerLinkKind = 'sd-customer' | 'sd-contact' | 'whatsapp-contact'

/** How a record was matched: a stored FK or the old text matching. */
export type CustomerLinkOrigin = 'link' | 'fallback'

export interface CustomerLinkCompanyDTO {
  id: string
  name: string
  cnpj: string | null
  origin: CustomerLinkOrigin
}

export interface CustomerLinkPersonDTO {
  id: string
  name: string
  companyId: string | null
  emails: string[]
  phones: string[]
  origin: CustomerLinkOrigin
}

export interface CustomerLinkSdCustomerDTO {
  id: string
  name: string
  document: string | null
  origin: CustomerLinkOrigin
}

export interface CustomerLinkSdContactDTO {
  id: string
  name: string
  email: string | null
  whatsapp: string | null
  origin: CustomerLinkOrigin
}

export interface CustomerLinkWhatsAppContactDTO {
  id: string
  name: string | null
  waId: string
  origin: CustomerLinkOrigin
}

/** Result of `CustomerLinkService.resolve`: everything known about one customer. */
export interface ResolvedCustomerDTO {
  company: CustomerLinkCompanyDTO | null
  person: CustomerLinkPersonDTO | null
  sdCustomers: CustomerLinkSdCustomerDTO[]
  sdContacts: CustomerLinkSdContactDTO[]
  whatsappContacts: CustomerLinkWhatsAppContactDTO[]
}

/** The current link of a record and the candidates to fix it. */
export interface CustomerLinkStateDTO {
  kind: CustomerLinkKind
  id: string
  /** Display name of the source record. */
  sourceName: string
  linked: { id: string; name: string; detail: string | null } | null
  suggestions: CustomerLinkSuggestionDTO[]
}

export interface CustomerLinkSuggestionDTO {
  id: string
  name: string
  /** Pt-BR short detail (CNPJ, e-mail, phone). */
  detail: string | null
  /** Why it was suggested, in pt-BR (e.g. "Mesmo CNPJ"). */
  reason: string
}
