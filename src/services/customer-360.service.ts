import 'server-only'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmOpportunityNotFound,
  crmPersonNotFound,
  validationError,
  whatsappConnectionNotFound,
} from '@/src/errors'
import { can } from '@/src/lib/permissions'
import { toStoredPhone } from '@/src/lib/phone-br'
import { err, ok, type Result } from '@/src/lib/result'
import { canSeeConversation } from '@/src/lib/whatsapp/conversation-scope'
import {
  toCustomer360CallDTO,
  toCustomer360CompanyDTO,
  toCustomer360ConversationDTO,
  toCustomer360DocumentDTO,
  toCustomer360HealthDTO,
  toCustomer360LeadDTO,
  toCustomer360OpportunityDTO,
  toCustomer360PersonDTO,
  toCustomer360TicketDTO,
} from '@/src/mappers/customer-360.mapper'
import {
  Customer360Repository,
  type Customer360Seed,
} from '@/src/repositories/customer-360.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type {
  Customer360Query,
  OpenCustomerWhatsappInput,
} from '@/src/schemas/customer-360.schema'
import type {
  Customer360DTO,
  Customer360OpenWhatsappResultDTO,
} from '@/types/customer-360'
import {
  assertModuleEnabled,
  assertModuleMember,
  type MembershipContext,
} from './authz'
import { ensureLeadContact } from './crm-lead-contact-sync'
import { pickLeadConnection } from './crm-lead-whatsapp.service'
import { SdAccess } from './sd-access'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'
import { WhatsAppConversationService } from './whatsapp-conversation.service'

/**
 * "Visão 360" of a customer: everything the workspace knows about a person or
 * company across the three modules, in one read. It never writes (except
 * `openWhatsapp`, which only opens a conversation) and it never widens
 * access: every block is gated by the viewer's own permission on the module
 * it comes from, and a block the viewer cannot see is reported as
 * unavailable instead of failing the whole view.
 *
 * CRM, ServiceDesk and WhatsApp share no foreign key, so the link is resolved
 * by `Customer360Repository.resolveIdentity` (phone key, CNPJ, e-mail, exact
 * name). That is the single place to swap for a persisted link.
 */

/** Runs `load` only when the viewer may read the block; else `fallback`. */
async function gated<T>(
  allowed: boolean,
  fallback: T,
  load: () => Promise<Result<T>>,
): Promise<Result<T>> {
  return allowed ? load() : ok(fallback)
}

const viewable = (ctx: MembershipContext, resource: string): boolean =>
  ctx.isPrivileged ||
  (ctx.permissions !== null && can(ctx.permissions, resource, 'VIEW'))

export const Customer360Service = {
  async get(
    actorId: string,
    workspaceId: string,
    query: Customer360Query,
  ): Promise<Result<Customer360DTO>> {
    const crm = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    if (!crm.ok) return crm

    const sd = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    const zapMembership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    const scope = zapMembership.ok
      ? await resolveConversationScope(
          actorId,
          workspaceId,
          zapMembership.value.role,
        )
      : null
    if (scope && !scope.ok) return scope
    const zapScope = scope?.ok ? scope.value : null

    const seed: Customer360Seed = {
      personId: query.personId,
      companyId: query.companyId,
      phone: query.phone,
    }
    let conversationId = query.conversationId ?? null

    if (query.ticketId) {
      if (!sd.ok) return sd
      const anchors = await Customer360Repository.ticketAnchors(
        workspaceId,
        query.ticketId,
      )
      if (!anchors.ok) return anchors
      if (anchors.value) {
        seed.sdCustomerId = anchors.value.sdCustomerId
        seed.sdContactId = anchors.value.sdContactId
        conversationId = conversationId ?? anchors.value.conversationId
      }
    }

    if (conversationId && !seed.phone) {
      if (!zapScope) {
        // A ticket may carry a conversation the viewer cannot open: skip it.
        if (query.conversationId && !zapMembership.ok) return zapMembership
      } else {
        const visible = await loadVisibleConversation(
          zapScope,
          workspaceId,
          conversationId,
        )
        if (visible.ok) {
          const phone = await Customer360Repository.conversationPhone(
            workspaceId,
            conversationId,
          )
          if (!phone.ok) return phone
          seed.phone = phone.value ?? undefined
        } else if (query.conversationId) {
          return visible
        } else {
          conversationId = null
        }
      }
    }

    const identity = await Customer360Repository.resolveIdentity(
      workspaceId,
      seed,
    )
    if (!identity.ok) return identity
    const who = identity.value

    const canCompanies = viewable(crm.value, 'companies')
    const canOpportunities = viewable(crm.value, 'opportunities')
    const canLeads = viewable(crm.value, 'leads')
    const canDocuments = viewable(crm.value, 'documents')

    const opportunities = await gated(canOpportunities, [], () =>
      Customer360Repository.listOpportunities(workspaceId, who),
    )
    if (!opportunities.ok) return opportunities
    const opportunityIds = opportunities.value.map((deal) => deal.id)

    const healthOf = canCompanies ? who.company : null
    const [health, leads, tickets, conversations, calls, documents] =
      await Promise.all([
        healthOf
          ? Customer360Repository.getHealth(workspaceId, healthOf.id)
          : Promise.resolve(ok(null)),
        gated(canLeads, [], () =>
          Customer360Repository.listLeads(workspaceId, who),
        ),
        gated(sd.ok, { rows: [], open: 0 }, () =>
          Customer360Repository.listTickets(workspaceId, who, conversationId),
        ),
        gated(zapScope !== null, [], () =>
          Customer360Repository.listConversations(workspaceId, who),
        ),
        gated(zapScope !== null, [], () =>
          Customer360Repository.listCalls(workspaceId, who, opportunityIds),
        ),
        gated(canDocuments, [], () =>
          Customer360Repository.listDocuments(workspaceId, who, opportunityIds),
        ),
      ])
    if (!health.ok) return health
    if (!leads.ok) return leads
    if (!tickets.ok) return tickets
    if (!conversations.ok) return conversations
    if (!calls.ok) return calls
    if (!documents.ok) return documents

    const visibleConversations = zapScope
      ? conversations.value
          .filter((conversation) => canSeeConversation(zapScope, conversation))
          .slice(0, 10)
      : []

    return ok({
      match: who.match,
      available: {
        crm: true,
        servicedesk: sd.ok,
        whatsapp: zapScope !== null,
      },
      person: who.person ? toCustomer360PersonDTO(who.person) : null,
      company: who.company ? toCustomer360CompanyDTO(who.company) : null,
      health: health.value ? toCustomer360HealthDTO(health.value) : null,
      opportunities: opportunities.value.map(toCustomer360OpportunityDTO),
      leads: leads.value.map(toCustomer360LeadDTO),
      tickets: tickets.value.rows.map(toCustomer360TicketDTO),
      openTickets: tickets.value.open,
      conversations: visibleConversations.map(toCustomer360ConversationDTO),
      calls: calls.value.map(toCustomer360CallDTO),
      documents: documents.value.map(toCustomer360DocumentDTO),
    })
  },

  /**
   * Opens (or reuses) the WhatsApp conversation of a person, company or deal.
   * The phone comes from the record: the explicit one when it belongs to it,
   * else the first usable one. Backs the "WhatsApp" and "Ligar" buttons.
   */
  async openWhatsapp(
    actorId: string,
    workspaceId: string,
    input: OpenCustomerWhatsappInput,
  ): Promise<Result<Customer360OpenWhatsappResultDTO>> {
    const subject = input.personId
      ? ({
          resource: 'people',
          entity: 'crm_person',
          id: input.personId,
        } as const)
      : input.opportunityId
        ? ({
            resource: 'opportunities',
            entity: 'crm_opportunity',
            id: input.opportunityId,
          } as const)
        : ({
            resource: 'companies',
            entity: 'crm_company',
            id: input.companyId as string,
          } as const)
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: subject.resource,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const enabled = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
    if (!enabled.ok) return enabled

    const target = await Customer360Repository.phoneTargets(workspaceId, input)
    if (!target.ok) return target
    if (!target.value) {
      return err(
        input.opportunityId ? crmOpportunityNotFound() : crmPersonNotFound(),
      )
    }

    const wanted = input.phone ? toStoredPhone(input.phone) : null
    const candidates = wanted
      ? target.value.phones.filter((phone) => toStoredPhone(phone) === wanted)
      : target.value.phones
    if (candidates.length === 0) {
      return err(
        validationError(
          input.phone
            ? 'Este cadastro não tem esse telefone'
            : 'Este cadastro não tem telefone. Adicione um número para conversar no WhatsApp.',
        ),
      )
    }

    let contact: { id: string; phone: string } | null = null
    for (const phone of candidates) {
      const ensured = await ensureLeadContact(
        workspaceId,
        target.value.name,
        phone,
      )
      if (!ensured.ok) return ensured
      if (ensured.value) {
        contact = { id: ensured.value.id, phone }
        break
      }
    }
    if (!contact) {
      return err(validationError('Telefone inválido para o WhatsApp'))
    }

    const connections =
      await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
    if (!connections.ok) return connections
    const connection = pickLeadConnection(connections.value)
    if (!connection) return err(whatsappConnectionNotFound())

    const conversation = await WhatsAppConversationService.start(
      actorId,
      workspaceId,
      { contactId: contact.id, connectionId: connection.id },
    )
    if (!conversation.ok) return conversation

    auditMutation({
      entity: subject.entity,
      action: 'update',
      actorId,
      targetId: subject.id,
      meta: { whatsappConversationId: conversation.value.id },
    })
    return ok({
      conversationId: conversation.value.id,
      contactId: contact.id,
      phone: contact.phone,
    })
  },
}
