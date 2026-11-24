import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { validationError, whatsappConnectionNotFound } from '@/src/errors'
import { toStoredPhone } from '@/src/lib/phone-br'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { assertModuleEnabled, assertModuleMember } from './authz'
import { ensureLeadContact } from './crm-lead-contact-sync'
import { WhatsAppConversationService } from './whatsapp-conversation.service'

/**
 * With no better hint, a new conversation goes out through a connected
 * Z-API line (free text) before a Meta one (template outside the 24h window).
 */
export function pickLeadConnection(
  connections: WhatsAppConnection[],
): WhatsAppConnection | null {
  const connected = connections.filter((c) => c.status === 'CONNECTED')
  return (
    connected.find((c) => c.provider === 'ZAPI') ??
    connected[0] ??
    connections[0] ??
    null
  )
}

export const CrmLeadWhatsappService = {
  /**
   * Opens the WhatsApp conversation of a lead phone: the open one when there
   * is one, else a new one. The contact is created as "Lead do CRM" when the
   * number is not a contact yet.
   */
  async open(
    actorId: string,
    workspaceId: string,
    leadId: string,
    input: { phone?: string; connectionId?: string } = {},
  ): Promise<Result<{ conversationId: string; contactId: string }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const enabled = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
    if (!enabled.ok) return enabled

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const wanted = input.phone ? toStoredPhone(input.phone) : null
    const phone =
      lead.value.phones.find((p) => toStoredPhone(p) === wanted) ??
      (input.phone ? undefined : lead.value.phones[0])
    if (!phone) {
      return err(validationError('Este lead não tem esse telefone'))
    }

    const contact = await ensureLeadContact(workspaceId, lead.value.name, phone)
    if (!contact.ok) return contact
    if (!contact.value) {
      return err(validationError('Telefone inválido para o WhatsApp'))
    }

    const connections =
      await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
    if (!connections.ok) return connections
    const connection = input.connectionId
      ? connections.value.find((c) => c.id === input.connectionId)
      : pickLeadConnection(connections.value)
    if (!connection) return err(whatsappConnectionNotFound())

    const conversation = await WhatsAppConversationService.start(
      actorId,
      workspaceId,
      { contactId: contact.value.id, connectionId: connection.id },
    )
    if (!conversation.ok) return conversation

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { whatsappConversationId: conversation.value.id },
    })
    return ok({
      conversationId: conversation.value.id,
      contactId: contact.value.id,
    })
  },
}
