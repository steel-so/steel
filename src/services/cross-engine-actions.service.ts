import type { SdTicketType } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { validationError, whatsappConnectionNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  normalizeSdWhatsappNumber,
  sdPlainTextToHtml,
} from '@/src/lib/servicedesk/whatsapp'
import {
  buildCrossEngineBodyComponents,
  CROSS_ENGINE_SKIP_MESSAGE,
  type CrossEngineSkipReason,
  decideCrossEngineSend,
} from '@/src/lib/whatsapp/cross-engine-send'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { CrmRetentionRepository } from '@/src/repositories/crm-retention.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { CrossEngineWhatsappRepository } from '@/src/repositories/cross-engine-whatsapp.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import type { SdContactDTO } from '@/types/sd-contact'
import { assertModuleEnabled } from './authz'
import { CrmLeadService } from './crm-lead.service'
import { fireSdAutomations } from './sd-automation-engine'
import { SdContactService } from './sd-contact.service'
import { SdTicketEngine, sdSystemActor, sdTicketCode } from './sd-ticket-engine'
import { checkWhatsAppOptOut } from './whatsapp-opt-out'

/**
 * Actions that one automation engine runs in another module: CRM workflow,
 * ServiceDesk automation and the zap chatbot all call these instead of each
 * wiring the other module by hand. Every action:
 *
 * - checks the target module is enabled for the workspace;
 * - is written as the system (no human actor), with `source` in the audit;
 * - never throws, and a send that must not happen (opt-out, closed window)
 *   is a `skipped` outcome with a pt-BR reason, not an error, so the flow
 *   that called it can go on.
 */

export type CrossEngineSource = 'crm_workflow' | 'sd_automation' | 'chatbot'

const LEAD_VIA = {
  crm_workflow: 'crm_workflow',
  sd_automation: 'sd_automation',
  chatbot: 'whatsapp_chatbot',
} as const

export interface CrossEngineSendInput {
  workspaceId: string
  source: CrossEngineSource
  /** Id of the rule/workflow/bot that fired it (audit only). */
  refId: string
  connectionId: string
  /** Any phone format; it is normalised to digits with the country code. */
  phone: string
  templateId?: string | null
  /** Body parameters, in order ({{1}}, {{2}}...). */
  variables?: string[]
  /** Free text: Z-API, or Meta inside the 24 h window. */
  text?: string | null
}

export type CrossEngineSendOutcome =
  | { status: 'sent'; providerMessageId: string; mode: 'template' | 'text' }
  | { status: 'skipped'; reason: CrossEngineSkipReason; message: string }

export interface CrossEngineTicketInput {
  workspaceId: string
  source: CrossEngineSource
  refId: string
  type: SdTicketType
  title: string
  description?: string | null
  /** Used to attach the SD contact/customer and to answer on WhatsApp. */
  phone?: string | null
  email?: string | null
  /** Zap conversation to link (the chatbot knows it). */
  whatsappConversationId?: string | null
}

export interface CrossEngineTicketOutcome {
  ticketId: string
  code: string
  /** `true`: the conversation already had an open ticket, which was reused. */
  reused: boolean
}

export interface CrossEngineLeadInput {
  workspaceId: string
  source: CrossEngineSource
  refId: string
  /** User the record is created for; falls back to a workspace admin. */
  authorId?: string | null
  name: string
  phone?: string | null
  email?: string | null
  company?: string | null
  /** Where the lead came from, as shown in the CRM. */
  origin: string
}

export interface CrossEngineLeadOutcome {
  leadId: string
  /** `false`: an open lead with this phone/e-mail already existed. */
  created: boolean
}

export interface CrossEngineTaskInput {
  workspaceId: string
  source: CrossEngineSource
  refId: string
  authorId?: string | null
  title: string
  body?: string | null
  assigneeId?: string | null
  dueInMinutes?: number | null
  personId?: string | null
  companyId?: string | null
  opportunityId?: string | null
}

export interface CrossEngineTaskOutcome {
  taskId: string
}

async function resolveAuthor(
  workspaceId: string,
  preferred?: string | null,
): Promise<Result<string | null>> {
  if (preferred) return ok(preferred)
  return CrmRetentionRepository.findFallbackUserId(workspaceId)
}

export const CrossEngineActions = {
  /**
   * Sends a WhatsApp message on behalf of an automation: Meta goes by an
   * approved template (any time) or text inside the 24 h window; Z-API by
   * text. A contact that opted out is never messaged.
   */
  async sendWhatsApp(
    input: CrossEngineSendInput,
  ): Promise<Result<CrossEngineSendOutcome>> {
    const waId = normalizeSdWhatsappNumber(input.phone)
    if (!waId) {
      return err(
        validationError(
          'O telefone do contato é inválido. Use DDD e número, por exemplo 11 91234-5678.',
        ),
      )
    }

    const connection = await CrossEngineWhatsappRepository.findConnection(
      input.workspaceId,
      input.connectionId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())
    if (connection.value.status !== 'CONNECTED') {
      return err(
        validationError(
          'A conexão do WhatsApp está desconectada. Reconecte o número em Ajustes > WhatsApp.',
        ),
      )
    }
    const conn = connection.value

    let templateApproved = false
    let template: Awaited<
      ReturnType<typeof CrossEngineWhatsappRepository.findTemplate>
    > | null = null
    if (input.templateId && conn.provider === 'META') {
      template = await CrossEngineWhatsappRepository.findTemplate(
        input.workspaceId,
        conn.id,
        input.templateId,
      )
      if (!template.ok) return template
      templateApproved = template.value?.status === 'APPROVED'
    }

    const text = input.text?.trim() ?? ''
    const optOut = await checkWhatsAppOptOut(input.workspaceId, waId)
    let lastInboundAt: Date | null = null
    if (conn.provider === 'META' && text) {
      const inbound = await CrossEngineWhatsappRepository.lastInboundAt(
        input.workspaceId,
        conn.id,
        waId,
      )
      if (!inbound.ok) return inbound
      lastInboundAt = inbound.value
    }

    const decision = decideCrossEngineSend({
      provider: conn.provider,
      optOut,
      hasTemplate: !!input.templateId,
      templateApproved,
      hasText: text.length > 0,
      lastInboundAt,
    })
    const log = {
      workspaceId: input.workspaceId,
      source: input.source,
      refId: input.refId,
      connectionId: conn.id,
    }
    if (decision.action === 'skip') {
      logger.info('cross_engine.whatsapp.skipped', {
        ...log,
        reason: decision.reason,
      })
      return ok({
        status: 'skipped',
        reason: decision.reason,
        message: CROSS_ENGINE_SKIP_MESSAGE[decision.reason],
      })
    }

    const approved = template?.ok ? template.value : null
    const sent =
      decision.action === 'template' && approved
        ? await WhatsAppSend.template(
            conn,
            {
              to: waId,
              templateName: approved.name,
              language: approved.language,
              components: applyTemplateSendExtras(
                approved,
                buildCrossEngineBodyComponents(input.variables ?? []),
              ).components,
            },
            { cost: { source: 'OTHER', templateCategory: approved.category } },
          )
        : await WhatsAppSend.text(
            conn,
            { to: waId, text },
            { cost: { source: 'OTHER' } },
          )
    if (!sent.ok) {
      auditMutation({
        entity: 'whatsapp_message',
        action: 'create',
        actorId: null,
        outcome: 'failure',
        reason: sent.error.code,
        meta: { ...log, via: 'cross_engine' },
      })
      return sent
    }
    auditMutation({
      entity: 'whatsapp_message',
      action: 'create',
      actorId: null,
      targetId: sent.value.providerMessageId,
      meta: { ...log, via: 'cross_engine', mode: decision.action },
    })
    return ok({
      status: 'sent',
      providerMessageId: sent.value.providerMessageId,
      mode: decision.action,
    })
  },

  /** Opens a ServiceDesk ticket (the requester is found by phone/e-mail). */
  async openTicket(
    input: CrossEngineTicketInput,
  ): Promise<Result<CrossEngineTicketOutcome>> {
    const enabled = await assertModuleEnabled(input.workspaceId, 'SERVICE_DESK')
    if (!enabled.ok) return enabled
    const config = await SdTicketEngine.loadConfig(input.workspaceId)
    if (!config.ok) return config

    // A retried bot step must not open a second ticket for the same chat.
    if (input.whatsappConversationId) {
      const open = await SdWhatsappRepository.findOpenTicket(
        input.workspaceId,
        input.whatsappConversationId,
      )
      if (!open.ok) return open
      if (open.value) {
        return ok({
          ticketId: open.value.id,
          code: sdTicketCode(open.value, config.value.prefixes),
          reused: true,
        })
      }
    }

    const waId = normalizeSdWhatsappNumber(input.phone)
    const email = input.email?.trim() || null
    let contact: SdContactDTO | null = null
    if (waId || email) {
      const found = await SdContactService.findByChannel(input.workspaceId, {
        whatsapp: waId,
        email,
      })
      if (found.ok) contact = found.value
      else {
        logger.warn('cross_engine.ticket.contact_lookup_failed', {
          workspaceId: input.workspaceId,
          reason: found.error.code,
        })
      }
    }
    const primary = contact?.customers[0]
    const description = input.description?.trim()

    const created = await SdTicketEngine.create(
      input.workspaceId,
      {
        type: input.type,
        title: input.title.trim().slice(0, 200),
        description: description ? sdPlainTextToHtml(description) : undefined,
        channel: input.source === 'chatbot' ? 'WHATSAPP' : 'API',
        contactId: contact?.id,
        customerId: primary?.kind === 'CLIENT' ? primary.id : undefined,
        companyId: primary?.kind === 'COMPANY' ? primary.id : undefined,
        requesterId: contact?.userId ?? null,
      },
      sdSystemActor(`cross-engine:${input.source}`),
      config.value,
    )
    if (!created.ok) {
      auditMutation({
        entity: 'sd_ticket',
        action: 'create',
        actorId: null,
        outcome: 'failure',
        reason: created.error.code,
        meta: {
          workspaceId: input.workspaceId,
          via: input.source,
          refId: input.refId,
        },
      })
      return created
    }

    if (input.whatsappConversationId) {
      const linked = await SdWhatsappRepository.setTicketConversation(
        created.value.id,
        input.whatsappConversationId,
      )
      if (!linked.ok) {
        logger.warn('cross_engine.ticket.conversation_link_failed', {
          workspaceId: input.workspaceId,
          ticketId: created.value.id,
          reason: linked.error.code,
        })
      }
    }
    auditMutation({
      entity: 'sd_ticket',
      action: 'create',
      actorId: null,
      targetId: created.value.id,
      meta: {
        workspaceId: input.workspaceId,
        type: input.type,
        via: input.source,
        refId: input.refId,
      },
    })
    void fireSdAutomations('TICKET_CREATED', created.value.id)
    return ok({
      ticketId: created.value.id,
      code: sdTicketCode(created.value, config.value.prefixes),
      reused: false,
    })
  },

  /** Creates (or reuses the open) CRM lead for a phone/e-mail. */
  async createLead(
    input: CrossEngineLeadInput,
  ): Promise<Result<CrossEngineLeadOutcome>> {
    const author = await resolveAuthor(input.workspaceId, input.authorId)
    if (!author.ok) return author
    if (!author.value) {
      return err(
        validationError(
          'Nenhum administrador encontrado para registrar o lead no CRM.',
        ),
      )
    }
    const phone = normalizeSdWhatsappNumber(input.phone)
    const email = input.email?.trim() || null
    if (!phone && !email) {
      return err(
        validationError(
          'Informe um telefone ou e-mail válido para criar o lead.',
        ),
      )
    }
    const result = await CrmLeadService.intake(
      input.workspaceId,
      {
        kind: 'system',
        createdById: author.value,
        via: LEAD_VIA[input.source],
        refId: input.refId,
      },
      {
        name: input.name.trim() || phone || email || 'Lead',
        phones: phone ? [phone] : [],
        emails: email ? [email] : [],
        company: input.company?.trim() || undefined,
        source: input.origin.slice(0, 100),
        channel: input.source === 'chatbot' ? 'WhatsApp' : undefined,
      },
    )
    if (!result.ok) return result
    return ok({ leadId: result.value.lead.id, created: result.value.created })
  },

  /** Creates a CRM task (no workflow event, so engines cannot loop). */
  async createCrmTask(
    input: CrossEngineTaskInput,
  ): Promise<Result<CrossEngineTaskOutcome>> {
    const enabled = await assertModuleEnabled(input.workspaceId, 'CRM')
    if (!enabled.ok) return enabled
    const author = await resolveAuthor(input.workspaceId, input.authorId)
    if (!author.ok) return author
    if (!author.value) {
      return err(
        validationError(
          'Nenhum administrador encontrado para registrar a tarefa no CRM.',
        ),
      )
    }
    const task = await CrmTaskRepository.create({
      workspaceId: input.workspaceId,
      createdById: author.value,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 5000) || undefined,
      dueDate: input.dueInMinutes
        ? new Date(Date.now() + input.dueInMinutes * 60_000)
        : undefined,
      assigneeId: input.assigneeId ?? undefined,
      personId: input.personId ?? undefined,
      companyId: input.companyId ?? undefined,
      opportunityId: input.opportunityId ?? undefined,
    })
    if (!task.ok) return task
    auditMutation({
      entity: 'crm_task',
      action: 'create',
      actorId: null,
      targetId: task.value.id,
      meta: {
        workspaceId: input.workspaceId,
        via: input.source,
        refId: input.refId,
      },
    })
    return ok({ taskId: task.value.id })
  },
}
