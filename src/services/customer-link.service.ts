import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { phoneMatchKey } from '@/src/lib/pabx/recording'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CustomerLinkRepository,
  type LinkCompanyRow,
  type LinkPersonRow,
  type LinkSdCustomerRow,
  phoneKeys,
} from '@/src/repositories/customer-link.repository'
import type {
  CustomerLinkKindInput,
  ResolveCustomerInput,
} from '@/src/schemas/customer-link.schema'
import type {
  CustomerLinkOrigin,
  CustomerLinkStateDTO,
  CustomerLinkSuggestionDTO,
  ResolvedCustomerDTO,
} from '@/types/customer-link'
import { assertModuleMember } from './authz'
import { SdAccess } from './sd-access'

/** What `resolve` receives: one identifier, scoped by workspace. */
export type ResolveCustomerArgs = { workspaceId: string } & ResolveCustomerInput

/** Which parts of the answer the caller may see. */
interface ResolveScope {
  sd: boolean
  whatsapp: boolean
}

const FULL_SCOPE: ResolveScope = { sd: true, whatsapp: true }

const sourceNotFound = () =>
  appError('CUSTOMER_LINK_SOURCE_NOT_FOUND', 'Cadastro não encontrado')
const targetNotFound = () =>
  appError(
    'CUSTOMER_LINK_TARGET_NOT_FOUND',
    'O cadastro do CRM escolhido não foi encontrado',
  )

const origin = (linked: boolean): CustomerLinkOrigin =>
  linked ? 'link' : 'fallback'

function toCompanyDTO(row: LinkCompanyRow, from: CustomerLinkOrigin) {
  return { id: row.id, name: row.name, cnpj: row.cnpj, origin: from }
}

function toPersonDTO(row: LinkPersonRow, from: CustomerLinkOrigin) {
  return {
    id: row.id,
    name: row.name,
    companyId: row.companyId,
    emails: row.emails,
    phones: row.phones,
    origin: from,
  }
}

const EMPTY: ResolvedCustomerDTO = {
  company: null,
  person: null,
  sdCustomers: [],
  sdContacts: [],
  whatsappContacts: [],
}

/**
 * Cadastro único (ADR 0066): one customer seen from CRM, ServiceDesk and
 * WhatsApp. The stored links (`SdCustomer.crmCompanyId`, `SdContact.crmPersonId`,
 * `WhatsAppContact.crmPersonId`) win; the old text matching (CNPJ, exact name,
 * e-mail, phone key) stays as a fallback for records that were never linked.
 */
export const CustomerLinkService = {
  /**
   * Stable resolver for other modules. Does NOT check permissions: the caller
   * must have authorized the actor already. Use {@link resolveForActor} from
   * a route.
   */
  async resolve(args: ResolveCustomerArgs): Promise<Result<ResolvedCustomerDTO>> {
    return resolveWithScope(args, FULL_SCOPE)
  },

  /** `resolve` for a user: CRM read access, plus SD / WhatsApp parts when allowed. */
  async resolveForActor(
    actorId: string,
    args: ResolveCustomerArgs,
  ): Promise<Result<ResolvedCustomerDTO>> {
    const crm = await assertModuleMember(actorId, args.workspaceId, 'CRM', {
      resource: 'companies',
      action: 'VIEW',
    })
    if (!crm.ok) return crm
    const sd = await SdAccess.requireAgent(actorId, args.workspaceId)
    const whatsapp = await assertModuleMember(
      actorId,
      args.workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'VIEW' },
    )
    return resolveWithScope(args, { sd: sd.ok, whatsapp: whatsapp.ok })
  },

  /** The current link of a record and the candidates to fix it. */
  async getState(
    actorId: string,
    workspaceId: string,
    kind: CustomerLinkKindInput,
    id: string,
  ): Promise<Result<CustomerLinkStateDTO>> {
    const access = await authorize(actorId, workspaceId, kind, 'VIEW')
    if (!access.ok) return access

    if (kind === 'sd-customer') {
      const source = await CustomerLinkRepository.findSdCustomer(workspaceId, id)
      if (!source.ok) return source
      if (!source.value) return err(sourceNotFound())
      const linked = source.value.crmCompanyId
        ? await CustomerLinkRepository.findCompany(
            workspaceId,
            source.value.crmCompanyId,
          )
        : ok(null)
      if (!linked.ok) return linked
      const candidates = await CustomerLinkRepository.listCompanyCandidates(
        workspaceId,
        { document: source.value.document, name: source.value.name },
      )
      if (!candidates.ok) return candidates
      return ok({
        kind,
        id,
        sourceName: source.value.name,
        linked: linked.value
          ? {
              id: linked.value.id,
              name: linked.value.name,
              detail: linked.value.cnpj,
            }
          : null,
        suggestions: candidates.value
          .filter((c) => c.id !== source.value?.crmCompanyId)
          .map(
            (c): CustomerLinkSuggestionDTO => ({
              id: c.id,
              name: c.name,
              detail: c.cnpj,
              reason: c.byCnpj ? 'Mesmo CNPJ' : 'Mesmo nome',
            }),
          ),
      })
    }

    // Person-based kinds: SD contact and WhatsApp contact.
    let sourceName: string
    let linkedPersonId: string | null
    let email: string | null = null
    let phones: (string | null)[] = []
    if (kind === 'sd-contact') {
      const source = await CustomerLinkRepository.findSdContact(workspaceId, id)
      if (!source.ok) return source
      if (!source.value) return err(sourceNotFound())
      sourceName = source.value.name
      linkedPersonId = source.value.crmPersonId
      email = source.value.email
      phones = [source.value.whatsapp, source.value.phone]
    } else {
      const source = await CustomerLinkRepository.findWhatsAppContact(
        workspaceId,
        id,
      )
      if (!source.ok) return source
      if (!source.value) return err(sourceNotFound())
      sourceName = source.value.name ?? source.value.waId
      linkedPersonId = source.value.crmPersonId
      phones = [/^\d+$/.test(source.value.waId) ? source.value.waId : null]
    }

    const linked = linkedPersonId
      ? await CustomerLinkRepository.findPerson(workspaceId, linkedPersonId)
      : ok(null)
    if (!linked.ok) return linked

    const suggestions = new Map<string, CustomerLinkSuggestionDTO>()
    if (email) {
      const byEmail = await CustomerLinkRepository.listPeopleByEmail(
        workspaceId,
        email,
      )
      if (!byEmail.ok) return byEmail
      for (const p of byEmail.value) suggestions.set(p.id, suggestionOf(p, 'Mesmo e-mail'))
    }
    const byPhone = await CustomerLinkRepository.listPeopleByPhoneKeys(
      workspaceId,
      phoneKeys(phones),
    )
    if (!byPhone.ok) return byPhone
    for (const p of byPhone.value) {
      if (!suggestions.has(p.id)) {
        suggestions.set(p.id, suggestionOf(p, 'Mesmo telefone'))
      }
    }
    if (linkedPersonId) suggestions.delete(linkedPersonId)

    return ok({
      kind,
      id,
      sourceName,
      linked: linked.value
        ? {
            id: linked.value.id,
            name: linked.value.name,
            detail: linked.value.emails[0] ?? linked.value.phones[0] ?? null,
          }
        : null,
      suggestions: [...suggestions.values()],
    })
  },

  /** Links a record to a CRM company (sd-customer) or person (the others). */
  async link(
    actorId: string,
    workspaceId: string,
    input: { kind: CustomerLinkKindInput; id: string; targetId: string },
  ): Promise<Result<true>> {
    return change(actorId, workspaceId, input.kind, input.id, input.targetId)
  },

  /** Removes the stored link; the text matching fallback may still match. */
  async unlink(
    actorId: string,
    workspaceId: string,
    input: { kind: CustomerLinkKindInput; id: string },
  ): Promise<Result<true>> {
    return change(actorId, workspaceId, input.kind, input.id, null)
  },
}

function suggestionOf(p: LinkPersonRow, reason: string): CustomerLinkSuggestionDTO {
  return {
    id: p.id,
    name: p.name,
    detail: p.emails[0] ?? p.phones[0] ?? null,
    reason,
  }
}

/** Permission to touch a source record plus the CRM side of the link. */
async function authorize(
  actorId: string,
  workspaceId: string,
  kind: CustomerLinkKindInput,
  action: 'VIEW' | 'EDIT',
): Promise<Result<true>> {
  const crm = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: kind === 'sd-customer' ? 'companies' : 'people',
    action,
  })
  if (!crm.ok) return crm
  if (kind === 'whatsapp-contact') {
    const zap = await assertModuleMember(actorId, workspaceId, 'COMMUNICATION', {
      resource: 'contacts',
      action,
    })
    return zap.ok ? ok(true) : zap
  }
  const sd = await SdAccess.requireAgent(actorId, workspaceId, {
    resource: kind === 'sd-customer' ? 'sd-customers' : 'sd-contacts',
    action,
  })
  return sd.ok ? ok(true) : sd
}

async function change(
  actorId: string,
  workspaceId: string,
  kind: CustomerLinkKindInput,
  id: string,
  targetId: string | null,
): Promise<Result<true>> {
  const action = targetId ? 'link' : 'unlink'
  const access = await authorize(actorId, workspaceId, kind, 'EDIT')
  if (!access.ok) return access

  const source =
    kind === 'sd-customer'
      ? await CustomerLinkRepository.findSdCustomer(workspaceId, id)
      : kind === 'sd-contact'
        ? await CustomerLinkRepository.findSdContact(workspaceId, id)
        : await CustomerLinkRepository.findWhatsAppContact(workspaceId, id)
  if (!source.ok) return source
  if (!source.value) return err(sourceNotFound())

  if (targetId) {
    const target =
      kind === 'sd-customer'
        ? await CustomerLinkRepository.findCompany(workspaceId, targetId)
        : await CustomerLinkRepository.findPerson(workspaceId, targetId)
    if (!target.ok) return target
    if (!target.value) return err(targetNotFound())
  }

  const saved = await CustomerLinkRepository.setLink(
    workspaceId,
    kind,
    id,
    targetId,
  )
  auditMutation({
    entity: 'customer_link',
    action: 'update',
    actorId,
    targetId: id,
    outcome: saved.ok ? 'success' : 'failure',
    ...(saved.ok ? {} : { reason: saved.error.code }),
    meta: { workspaceId, kind, change: action, crmId: targetId },
  })
  return saved
}

async function resolveWithScope(
  args: ResolveCustomerArgs,
  scope: ResolveScope,
): Promise<Result<ResolvedCustomerDTO>> {
  const { workspaceId } = args
  let company: LinkCompanyRow | null = null
  let companyLinked = false
  let people: LinkPersonRow[] = []
  let personLinked = false
  let seedCustomer: LinkSdCustomerRow | null = null
  let phoneOnly: string | null = null

  if (args.sdCustomerId) {
    const customer = await CustomerLinkRepository.findSdCustomer(
      workspaceId,
      args.sdCustomerId,
    )
    if (!customer.ok) return customer
    if (!customer.value) return ok(EMPTY)
    seedCustomer = customer.value
    const found = customer.value.crmCompanyId
      ? await CustomerLinkRepository.findCompany(
          workspaceId,
          customer.value.crmCompanyId,
        )
      : customer.value.document
        ? await CustomerLinkRepository.findCompanyByCnpj(
            workspaceId,
            customer.value.document,
          )
        : ok(null)
    if (!found.ok) return found
    company = found.value
    companyLinked = Boolean(customer.value.crmCompanyId)
  } else if (args.companyId) {
    const found = await CustomerLinkRepository.findCompany(
      workspaceId,
      args.companyId,
    )
    if (!found.ok) return found
    company = found.value
    companyLinked = true
  } else if (args.cnpj) {
    const found = await CustomerLinkRepository.findCompanyByCnpj(
      workspaceId,
      args.cnpj,
    )
    if (!found.ok) return found
    company = found.value
    companyLinked = true
  } else if (args.personId) {
    const found = await CustomerLinkRepository.findPerson(
      workspaceId,
      args.personId,
    )
    if (!found.ok) return found
    if (found.value) {
      people = [found.value]
      personLinked = true
    }
  } else if (args.phone) {
    const key = phoneMatchKey(args.phone)
    phoneOnly = args.phone
    const found = await CustomerLinkRepository.listPeopleByPhoneKeys(
      workspaceId,
      key ? [key] : [],
      1,
    )
    if (!found.ok) return found
    people = found.value
  }

  const person = people[0] ?? null
  if (!company && person?.companyId) {
    const found = await CustomerLinkRepository.findCompany(
      workspaceId,
      person.companyId,
    )
    if (!found.ok) return found
    company = found.value
    companyLinked = true
  }

  const out: ResolvedCustomerDTO = {
    company: company ? toCompanyDTO(company, origin(companyLinked)) : null,
    person: person ? toPersonDTO(person, origin(personLinked)) : null,
    sdCustomers: [],
    sdContacts: [],
    whatsappContacts: [],
  }

  if (scope.sd) {
    let customers: LinkSdCustomerRow[] = []
    if (company) {
      const listed = await CustomerLinkRepository.listSdCustomersForCompany(
        workspaceId,
        company,
      )
      if (!listed.ok) return listed
      customers = listed.value
    }
    if (seedCustomer && !customers.some((c) => c.id === seedCustomer?.id)) {
      customers = [seedCustomer, ...customers]
    }
    out.sdCustomers = customers.map((c) => ({
      id: c.id,
      name: c.name,
      document: c.document,
      origin: origin(c.crmCompanyId !== null && c.crmCompanyId === company?.id),
    }))
    if (person || phoneOnly) {
      const contacts = person
        ? await CustomerLinkRepository.listSdContactsForPerson(
            workspaceId,
            person,
          )
        : await CustomerLinkRepository.listSdContacts(workspaceId, {
            personId: null,
            emails: [],
            keys: phoneKeys([phoneOnly]),
          })
      if (!contacts.ok) return contacts
      out.sdContacts = contacts.value.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        whatsapp: c.whatsapp ?? c.phone,
        origin: origin(Boolean(person) && c.crmPersonId === person?.id),
      }))
    }
  }

  if (scope.whatsapp && (person || phoneOnly)) {
    const contacts = await CustomerLinkRepository.listWhatsAppContacts(
      workspaceId,
      {
        personId: person?.id ?? null,
        phones: person ? person.phones : [phoneOnly ?? ''],
      },
    )
    if (!contacts.ok) return contacts
    out.whatsappContacts = contacts.value.map((c) => ({
      id: c.id,
      name: c.name,
      waId: c.waId,
      origin: origin(Boolean(person) && c.crmPersonId === person?.id),
    }))
  }

  return ok(out)
}
