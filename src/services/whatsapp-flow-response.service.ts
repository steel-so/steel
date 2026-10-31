import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppContact,
  WhatsAppFlow,
  WhatsAppFlowResponse,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { err, ok, type Result } from '@/src/lib/result'
import {
  flowIdFromToken,
  type MappedAnswers,
  mapAnswers,
  parseFlowReply,
  sanitizeAnswers,
  summarizeAnswers,
} from '@/src/lib/whatsapp/flows/answers'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { parseStoredDefinition } from '@/src/mappers/whatsapp-flow.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { assertModuleEnabled } from './authz'
import { CrmDuplicateService } from './crm-duplicate.service'
import { CrmLeadService } from './crm-lead.service'
import { WhatsAppSchedulingService } from './whatsapp-scheduling.service'

export interface InboundFlowReply {
  workspaceId: string
  connection: WhatsAppConnection
  contact: WhatsAppContact
  conversationId: string
  /** The inbound message row that carried the reply. */
  messageId: string
  /** `interactive.nfm_reply.response_json` as Meta sent it. */
  responseJson: string
}

export interface FlowReplyOutcome {
  /** The reply belongs to a flow of ours (the AI / chatbot stay quiet). */
  handled: boolean
  /** Timeline text of the answer, with the summary. */
  text?: string
  afterPublish?: () => Promise<void>
}

interface MappingOutcome {
  createdLeadId?: string
  createdPersonId?: string
  createdCompanyId?: string
  note?: string
}

/** Phone digits of the contact, when its identity key is a phone. */
function contactPhone(contact: WhatsAppContact): string | undefined {
  return /^\d+$/.test(contact.waId) ? contact.waId : undefined
}

async function applyContactMapping(
  contact: WhatsAppContact,
  mapped: MappedAnswers,
): Promise<void> {
  const name = mapped.contact?.name
  if (!name || name === contact.name) return
  const updated = await WhatsAppContactRepository.update(contact.id, { name })
  if (!updated.ok) {
    logger.warn('whatsapp.flow.contact_update_failed', {
      contactId: contact.id,
      reason: updated.error.code,
    })
  }
}

async function applyCrmMapping(
  flow: WhatsAppFlow,
  contact: WhatsAppContact,
  responseId: string,
  mapped: MappedAnswers,
): Promise<MappingOutcome> {
  if (flow.crmAction === 'NONE') return {}
  if (!flow.createdByUserId) {
    return {
      note: 'O formulário não tem responsável para criar o registro no CRM',
    }
  }
  const enabled = await assertModuleEnabled(flow.workspaceId, 'CRM')
  if (!enabled.ok) {
    return {
      note: 'O módulo CRM está desabilitado: a resposta ficou só no WhatsApp',
    }
  }

  if (flow.crmAction === 'LEAD') {
    const attrs = mapped.lead ?? {}
    const phone = attrs.phone ?? contactPhone(contact)
    const intake = await CrmLeadService.intake(
      flow.workspaceId,
      {
        kind: 'system',
        createdById: flow.createdByUserId,
        via: 'whatsapp_flow',
        refId: responseId,
      },
      {
        name:
          attrs.name ??
          mapped.contact?.name ??
          contact.name ??
          phone ??
          'Sem nome',
        emails: attrs.email ? [attrs.email] : [],
        phones: phone ? [phone] : [],
        company: attrs.company,
        jobTitle: attrs.jobTitle,
        source:
          attrs.source ?? `Formulário WhatsApp: ${flow.name}`.slice(0, 100),
        channel: 'WhatsApp',
      },
    )
    if (!intake.ok) return { note: `Lead não criado: ${intake.error.message}` }
    return { createdLeadId: intake.value.lead.id }
  }

  if (flow.crmAction === 'PERSON') {
    const attrs = mapped.person ?? {}
    const phone = attrs.phone ?? contactPhone(contact)
    const created = await CrmPersonRepository.create({
      workspaceId: flow.workspaceId,
      createdById: flow.createdByUserId,
      name: attrs.name ?? attrs.email ?? contact.name ?? phone ?? 'Sem nome',
      emails: attrs.email ? [attrs.email] : [],
      phones: phone ? [phone] : [],
      city: attrs.city,
      jobTitle: attrs.jobTitle,
      linkedin: attrs.linkedin,
      avatar: attrs.avatar,
    })
    if (!created.ok)
      return { note: `Pessoa não criada: ${created.error.message}` }
    void CrmDuplicateService.flagOnArrival(
      flow.workspaceId,
      'PERSON',
      created.value.id,
    )
    return { createdPersonId: created.value.id }
  }

  const attrs = mapped.company ?? {}
  const employees = attrs.employees ? Number(attrs.employees) : undefined
  const arr = attrs.arr ? Number(attrs.arr) : undefined
  const created = await CrmCompanyRepository.create({
    workspaceId: flow.workspaceId,
    createdById: flow.createdByUserId,
    name: attrs.name ?? 'Sem nome',
    cnpj: attrs.cnpj,
    domain: attrs.domain,
    employees: Number.isFinite(employees) ? employees : undefined,
    linkedin: attrs.linkedin,
    arr: Number.isFinite(arr) ? arr : undefined,
  })
  if (!created.ok)
    return { note: `Empresa não criada: ${created.error.message}` }
  void CrmDuplicateService.flagOnArrival(
    flow.workspaceId,
    'COMPANY',
    created.value.id,
  )
  return { createdCompanyId: created.value.id }
}

/** Writes the answers on the timeline message instead of the placeholder. */
async function annotateMessage(
  messageId: string,
  flowName: string,
  summary: string,
): Promise<string> {
  const text = summary
    ? `Formulário respondido: ${flowName}\n${summary}`
    : `Formulário respondido: ${flowName}`
  const updated = await WhatsAppMessageRepository.update(messageId, { text })
  if (!updated.ok) {
    logger.warn('whatsapp.flow.annotate_failed', {
      messageId,
      reason: updated.error.code,
    })
  }
  return text
}

/** Thanks the contact right away (the 24h window just opened). */
async function sendConfirmation(
  input: InboundFlowReply,
  text: string,
): Promise<void> {
  const to = input.contact.waId
  const sent = await WhatsAppSend.text(
    input.connection,
    { to, text },
    { cost: { source: 'OTHER', conversationId: input.conversationId } },
  )
  if (!sent.ok) {
    logger.warn('whatsapp.flow.confirmation_failed', {
      conversationId: input.conversationId,
      reason: sent.error.code,
    })
    return
  }
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMessageId: sent.value.providerMessageId,
    status: 'SENT',
  })
  if (!message.ok) return
  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(input.workspaceId, {
    type: 'message.created',
    conversationId: input.conversationId,
    message: toWhatsAppMessageDTO(message.value),
  })
}

/** The pending send this reply answers, or a fresh row for an unknown send. */
async function resolveResponse(
  input: InboundFlowReply,
  flowToken: string | null,
): Promise<
  Result<{ flow: WhatsAppFlow; response: WhatsAppFlowResponse } | null>
> {
  let response: WhatsAppFlowResponse | null = null
  if (flowToken) {
    const found = await WhatsAppFlowResponseRepository.findByToken(
      input.workspaceId,
      flowToken,
    )
    if (!found.ok) return found
    response = found.value
  }
  if (!response) {
    // A template sent from the regular picker carries no token of ours:
    // the newest pending flow of the conversation owns the answer.
    const open =
      await WhatsAppFlowResponseRepository.findLatestOpenByConversation(
        input.workspaceId,
        input.conversationId,
      )
    if (!open.ok) return open
    response = open.value
  }

  const flowId = response?.flowId ?? flowIdFromToken(flowToken)
  if (!flowId) return ok(null)
  const flow = await WhatsAppFlowRepository.findById(flowId, input.workspaceId)
  if (!flow.ok) return flow
  if (!flow.value) return ok(null)

  if (!response) {
    const created = await WhatsAppFlowResponseRepository.create({
      workspaceId: input.workspaceId,
      flowId: flow.value.id,
      contactId: input.contact.id,
      conversationId: input.conversationId,
      // No pending send means the flow id came out of the token itself.
      flowToken: flowToken as string,
    })
    if (!created.ok) return created
    response = created.value
  }
  return ok({ flow: flow.value, response })
}

export const WhatsAppFlowResponseService = {
  /**
   * An inbound `nfm_reply`: stores the answers, fills the contact and the CRM
   * as the flow maps them and thanks the contact. `handled: false` means the
   * reply belongs to no flow of ours (it stays a plain message).
   */
  async handleInbound(
    input: InboundFlowReply,
  ): Promise<Result<FlowReplyOutcome>> {
    const parsed = parseFlowReply(input.responseJson)
    if (!parsed) return ok({ handled: false })

    const resolved = await resolveResponse(input, parsed.flowToken)
    if (!resolved.ok) return resolved
    if (!resolved.value) return ok({ handled: false })
    const { flow, response } = resolved.value

    const definition = parseStoredDefinition(
      flow.publishedDefinition ?? flow.definition,
    )
    const answers = sanitizeAnswers(definition, parsed.answers)

    // Claims the answer first: a webhook retry finds it already completed.
    const claimed = await WhatsAppFlowResponseRepository.complete(response.id, {
      answers: answers as Prisma.InputJsonValue,
      conversationId: input.conversationId,
    })
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok({ handled: true })

    const mapped = mapAnswers(definition, answers)
    await applyContactMapping(input.contact, mapped)
    const outcome = await applyCrmMapping(
      flow,
      input.contact,
      response.id,
      mapped,
    )
    const saved = await WhatsAppFlowResponseRepository.setMapping(response.id, {
      createdLeadId: outcome.createdLeadId ?? null,
      createdPersonId: outcome.createdPersonId ?? null,
      createdCompanyId: outcome.createdCompanyId ?? null,
      mappingNote: outcome.note ?? null,
    })
    if (!saved.ok) {
      return err(saved.error)
    }

    const text = await annotateMessage(
      input.messageId,
      flow.name,
      summarizeAnswers(definition, answers),
    )
    // The booking Flow (Z10) books a slot; what it tells the contact replaces
    // the Flow's generic thank-you.
    const booking = await WhatsAppSchedulingService.bookFromFlow({
      workspaceId: input.workspaceId,
      flowId: flow.id,
      contact: input.contact,
      conversationId: input.conversationId,
      answers,
    })
    if (!booking.ok) {
      logger.warn('whatsapp.flow.booking_failed', {
        workspaceId: input.workspaceId,
        flowId: flow.id,
        reason: booking.error.code,
      })
    }
    const confirmation =
      (booking.ok && booking.value.text) || flow.confirmationText

    auditMutation({
      entity: 'whatsapp_flow_response',
      action: 'respond',
      actorId: null,
      targetId: response.id,
      meta: {
        workspaceId: input.workspaceId,
        flowId: flow.id,
        crmAction: flow.crmAction,
        lead: Boolean(outcome.createdLeadId),
        person: Boolean(outcome.createdPersonId),
        company: Boolean(outcome.createdCompanyId),
      },
    })
    return ok({
      handled: true,
      text,
      // Run by the webhook after it published the answer, so the thank-you
      // lands below it on the timeline.
      afterPublish: confirmation
        ? () => sendConfirmation(input, confirmation)
        : undefined,
    })
  },
}
