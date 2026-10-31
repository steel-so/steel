import { randomBytes } from 'node:crypto'
import type {
  WhatsAppConnection,
  WhatsAppPixCharge,
  WhatsAppPixSettings,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  forbidden,
  notFound,
  pixChargeNotFound,
  pixChargeNotPending,
  pixDisabled,
  whatsappConnectionNotFound,
  whatsappConversationAiHandling,
  whatsappConversationNotFound,
} from '@/src/errors'
import type {
  PixPaymentNotification,
  PixProvider,
} from '@/src/lib/pix/provider'
import {
  getActivePixProvider,
  getPixProviderById,
} from '@/src/lib/pix/registry'
import { err, ok, type Result } from '@/src/lib/result'
import { agentCost } from '@/src/lib/whatsapp/cost'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import {
  toWhatsAppPixChargeDTO,
  toWhatsAppPixSettingsDTO,
} from '@/src/mappers/whatsapp-pix.mapper'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithPreview,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  WhatsAppPixChargeRepository,
  WhatsAppPixSettingsRepository,
} from '@/src/repositories/whatsapp-pix.repository'
import type {
  CreateWhatsAppPixChargeDTO,
  UpdateWhatsAppPixSettingsDTO,
} from '@/src/schemas/whatsapp-pix.schema'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type {
  WhatsAppPixChargeDTO,
  WhatsAppPixSettingsDTO,
} from '@/types/whatsapp-pix'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'
import { WhatsAppSlaService } from './whatsapp-sla.service'

/** Pix is Brazilian: amounts and deadlines read in BRL and São Paulo time. */
const PIX_TIMEZONE = 'America/Sao_Paulo'
const MS_PER_MINUTE = 60_000

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
const DEADLINE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: PIX_TIMEZONE,
})

export function formatPixAmount(amount: number): string {
  return BRL.format(amount)
}

/** First message of a charge: what is being paid and until when. */
export function pixIntroText(input: {
  amount: number
  description: string
  expiresAt: Date
}): string {
  return [
    `*Cobrança Pix: ${formatPixAmount(input.amount)}*`,
    input.description,
    '',
    `Vale até ${DEADLINE.format(input.expiresAt).replace(',', ' às')}.`,
    'Copie o código da próxima mensagem e cole em "Pix Copia e Cola" no app do seu banco.',
  ].join('\n')
}

/** 32 letters and digits: a valid Pix txid (26 to 35 characters). */
function newTxid(): string {
  return randomBytes(16).toString('hex')
}

async function loadSettings(
  workspaceId: string,
): Promise<Result<WhatsAppPixSettings | null>> {
  return WhatsAppPixSettingsRepository.findByWorkspace(workspaceId)
}

/** Settings row of a workspace where the Pix is on, or `PIX_DISABLED`. */
async function requireEnabled(
  workspaceId: string,
): Promise<Result<{ settings: WhatsAppPixSettings; provider: PixProvider }>> {
  const settings = await loadSettings(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value?.enabled) return err(pixDisabled())
  const provider = getActivePixProvider()
  if (!provider.ok) return provider
  return ok({ settings: settings.value, provider: provider.value })
}

async function publishCharge(charge: WhatsAppPixCharge): Promise<void> {
  await publishWhatsAppEvent(charge.workspaceId, {
    type: 'pix-charge.updated',
    conversationId: charge.conversationId,
    charge: toWhatsAppPixChargeDTO(charge),
  })
}

interface Delivery {
  workspaceId: string
  conversation: WhatsAppConversationWithPreview
  connection: WhatsAppConnection
  /** Sender agent; `null` when the AI sends. */
  actorId: string | null
}

/** Sends a text through the provider and records it in the conversation. */
async function deliverText(
  delivery: Delivery,
  text: string,
): Promise<Result<WhatsAppMessageDTO>> {
  const { workspaceId, conversation, connection, actorId } = delivery
  const byAi = actorId === null

  const sent = await WhatsAppSend.text(
    connection,
    { to: conversation.contact.waId, text },
    {
      cost: actorId
        ? agentCost(actorId, conversation.id)
        : { source: 'AI_REPLY', conversationId: conversation.id },
    },
  )
  if (!sent.ok) return sent

  const message = await WhatsAppMessageRepository.create({
    workspaceId,
    conversationId: conversation.id,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMessageId: sent.value.providerMessageId,
    status: 'SENT',
    senderUserId: actorId ?? undefined,
    sentByAi: byAi,
  })
  if (!message.ok) return message

  await WhatsAppConversationRepository.update(conversation.id, {
    lastMessageAt: new Date(),
    ...(byAi ? {} : { status: 'IN_PROGRESS' as const }),
  })
  if (actorId) {
    await WhatsAppSlaService.onOutbound({
      workspaceId,
      conversationId: conversation.id,
      senderUserId: actorId,
      byAi: false,
    })
  }

  const dto = toWhatsAppMessageDTO(message.value)
  await publishWhatsAppEvent(workspaceId, {
    type: 'message.created',
    conversationId: conversation.id,
    message: dto,
  })
  const fresh = await WhatsAppConversationRepository.findById(
    conversation.id,
    workspaceId,
  )
  if (fresh.ok && fresh.value) {
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(fresh.value),
    })
  }
  return ok(dto)
}

interface IssueInput {
  delivery: Delivery
  amount: number
  description: string
  expiresInMinutes: number
  opportunityId?: string
  provider: PixProvider
}

/** Creates the charge at the PSP, stores it and sends the two messages. */
async function issueCharge(
  input: IssueInput,
): Promise<Result<WhatsAppPixChargeDTO>> {
  const { delivery, provider } = input
  const expiresAt = new Date(
    Date.now() + input.expiresInMinutes * MS_PER_MINUTE,
  )

  const issued = await provider.createCharge({
    txid: newTxid(),
    amount: input.amount,
    description: input.description,
    expiresAt,
  })
  if (!issued.ok) return issued

  const stored = await WhatsAppPixChargeRepository.create({
    workspaceId: delivery.workspaceId,
    conversationId: delivery.conversation.id,
    opportunityId: input.opportunityId,
    createdById: delivery.actorId,
    createdByAi: delivery.actorId === null,
    provider: provider.id,
    providerChargeId: issued.value.providerChargeId,
    amount: input.amount,
    description: input.description,
    brCode: issued.value.brCode,
    expiresAt,
  })
  if (!stored.ok) {
    await provider.cancelCharge(issued.value.providerChargeId)
    return stored
  }

  // Two messages: the explanation, then the bare code so it copies cleanly.
  const intro = await deliverText(
    delivery,
    pixIntroText({
      amount: input.amount,
      description: input.description,
      expiresAt,
    }),
  )
  const code = intro.ok
    ? await deliverText(delivery, issued.value.brCode)
    : intro
  if (!code.ok) {
    // Nothing reached the customer: the charge must not stay payable.
    await provider.cancelCharge(issued.value.providerChargeId)
    await WhatsAppPixChargeRepository.markCanceled(stored.value.id)
    return code
  }

  auditMutation({
    entity: 'whatsapp_pix_charge',
    action: 'send',
    actorId: delivery.actorId,
    targetId: stored.value.id,
    meta: {
      workspaceId: delivery.workspaceId,
      conversationId: delivery.conversation.id,
      amount: input.amount,
      byAi: delivery.actorId === null,
      opportunityId: input.opportunityId ?? null,
    },
  })
  await publishCharge(stored.value)
  return ok(toWhatsAppPixChargeDTO(stored.value))
}

/** Module member allowed to act on conversations, plus their visibility. */
async function authorizeConversation(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'CREATE' | 'EDIT',
) {
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action },
  )
  if (!membership.ok) return membership
  return resolveConversationScope(actorId, workspaceId, membership.value.role)
}

async function checkOpportunity(
  workspaceId: string,
  opportunityId: string | undefined,
): Promise<Result<void>> {
  if (!opportunityId) return ok(undefined)
  const found = await CrmOpportunityRepository.findById(
    opportunityId,
    workspaceId,
  )
  if (!found.ok) {
    return found.error.code === 'RESOURCE_NOT_FOUND'
      ? err(badRequest('A oportunidade informada não existe neste workspace'))
      : found
  }
  return ok(undefined)
}

/** Adds the payment to the deal the charge was made for. */
async function noteOnOpportunity(charge: WhatsAppPixCharge): Promise<void> {
  if (!charge.opportunityId) return
  const opportunity = await CrmOpportunityRepository.findById(
    charge.opportunityId,
    charge.workspaceId,
  )
  if (!opportunity.ok) return
  const note = await CrmNoteRepository.create({
    workspaceId: charge.workspaceId,
    createdById: charge.createdById ?? opportunity.value.createdById,
    opportunityId: charge.opportunityId,
    title: 'Pix recebido',
    body: `Pix de ${formatPixAmount(Number(charge.paidAmount ?? charge.amount))} recebido pelo WhatsApp: ${charge.description}.`,
  })
  if (!note.ok) {
    logger.warn('whatsapp.pix.note_failed', {
      chargeId: charge.id,
      code: note.error.code,
    })
  }
}

export const WhatsAppPixService = {
  /** Switch and defaults of the workspace (any module member reads them). */
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPixSettingsDTO>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const settings = await loadSettings(workspaceId)
    if (!settings.ok) return settings
    const provider = getActivePixProvider()
    if (!provider.ok) return provider
    return ok(
      toWhatsAppPixSettingsDTO(workspaceId, settings.value, provider.value),
    )
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppPixSettingsDTO,
  ): Promise<Result<WhatsAppPixSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const provider = getActivePixProvider()
    if (!provider.ok) return provider

    const saved = await WhatsAppPixSettingsRepository.upsert(workspaceId, {
      ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
      ...(dto.defaultExpiresMinutes === undefined
        ? {}
        : { defaultExpiresMinutes: dto.defaultExpiresMinutes }),
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_pix_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, ...dto },
    })
    return ok(
      toWhatsAppPixSettingsDTO(workspaceId, saved.value, provider.value),
    )
  },

  /** An agent charges the contact of a conversation they can see. */
  async createCharge(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: CreateWhatsAppPixChargeDTO,
  ): Promise<Result<WhatsAppPixChargeDTO>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const enabled = await requireEnabled(workspaceId)
    if (!enabled.ok) return enabled

    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation
    if (conversation.value.aiActive)
      return err(whatsappConversationAiHandling())

    const open = await WhatsAppBusinessHoursService.assertOpen(workspaceId)
    if (!open.ok) return open

    const connection = await WhatsAppConnectionRepository.findById(
      conversation.value.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const opportunity = await checkOpportunity(workspaceId, dto.opportunityId)
    if (!opportunity.ok) return opportunity

    return issueCharge({
      delivery: {
        workspaceId,
        conversation: conversation.value,
        connection: connection.value,
        actorId,
      },
      amount: dto.amount,
      description: dto.description,
      expiresInMinutes:
        dto.expiresInMinutes ?? enabled.value.settings.defaultExpiresMinutes,
      opportunityId: dto.opportunityId,
      provider: enabled.value.provider,
    })
  },

  /**
   * The AI of a campaign charges its conversation (campaign action
   * `SEND_PIX`: amount and description are fixed by the admin). Skips the
   * agent checks — the AI is the one in charge of the conversation.
   */
  async createChargeForAi(input: {
    workspaceId: string
    conversationId: string
    amount: number
    description: string
  }): Promise<Result<WhatsAppPixChargeDTO>> {
    const enabled = await requireEnabled(input.workspaceId)
    if (!enabled.ok) return enabled

    const conversation = await WhatsAppConversationRepository.findById(
      input.conversationId,
      input.workspaceId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value) return err(whatsappConversationNotFound())

    const connection = await WhatsAppConnectionRepository.findById(
      conversation.value.connectionId,
      input.workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    return issueCharge({
      delivery: {
        workspaceId: input.workspaceId,
        conversation: conversation.value,
        connection: connection.value,
        actorId: null,
      },
      amount: input.amount,
      description: input.description,
      expiresInMinutes: enabled.value.settings.defaultExpiresMinutes,
      provider: enabled.value.provider,
    })
  },

  async listByConversation(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppPixChargeDTO[]>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope
    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const charges = await WhatsAppPixChargeRepository.listByConversation(
      conversationId,
      workspaceId,
    )
    if (!charges.ok) return charges
    return ok(charges.value.map((charge) => toWhatsAppPixChargeDTO(charge)))
  },

  /** Charges of a CRM deal (CRM module members). */
  async listByOpportunity(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<WhatsAppPixChargeDTO[]>> {
    const member = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!member.ok) return member
    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity

    const charges = await WhatsAppPixChargeRepository.listByOpportunity(
      opportunityId,
      workspaceId,
    )
    if (!charges.ok) return charges
    return ok(charges.value.map((charge) => toWhatsAppPixChargeDTO(charge)))
  },

  async cancel(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    chargeId: string,
  ): Promise<Result<WhatsAppPixChargeDTO>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const found = await WhatsAppPixChargeRepository.findById(
      chargeId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value || found.value.conversationId !== conversationId) {
      return err(pixChargeNotFound())
    }
    const dto = toWhatsAppPixChargeDTO(found.value)
    if (dto.status !== 'PENDING') return err(pixChargeNotPending())

    const provider = getPixProviderById(found.value.provider)
    if (!provider.ok) return provider
    const stopped = await provider.value.cancelCharge(
      found.value.providerChargeId,
    )
    if (!stopped.ok) return stopped

    const canceled = await WhatsAppPixChargeRepository.markCanceled(chargeId)
    if (!canceled.ok) return canceled
    if (!canceled.value) return err(pixChargeNotPending())

    auditMutation({
      entity: 'whatsapp_pix_charge',
      action: 'cancel',
      actorId,
      targetId: chargeId,
      meta: { workspaceId, conversationId },
    })
    await publishCharge(canceled.value)
    return ok(toWhatsAppPixChargeDTO(canceled.value))
  },

  /**
   * Test providers only: settles a charge as if the customer paid it, so a
   * workspace can try the whole flow. Restricted to OWNER/ADMIN.
   */
  async simulatePayment(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    chargeId: string,
  ): Promise<Result<WhatsAppPixChargeDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const found = await WhatsAppPixChargeRepository.findById(
      chargeId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value || found.value.conversationId !== conversationId) {
      return err(pixChargeNotFound())
    }
    const provider = getPixProviderById(found.value.provider)
    if (!provider.ok) return provider
    if (!provider.value.isTest) return err(forbidden())

    const paid = await WhatsAppPixService.handlePayment(provider.value.id, {
      providerChargeId: found.value.providerChargeId,
      paidAmount: Number(found.value.amount),
      paidAt: new Date(),
      endToEndId: null,
      payerName: null,
    })
    if (!paid.ok) return paid

    auditMutation({
      entity: 'whatsapp_pix_charge',
      action: 'test',
      actorId,
      targetId: chargeId,
      meta: { workspaceId, conversationId, simulated: true },
    })
    return paid
  },

  /**
   * Payment notice from the PSP (already authenticated by the provider).
   * Idempotent: a repeated notice of a paid charge changes nothing. Marks the
   * charge paid, drops a PIX_PAID chip in the conversation and notes the
   * deal in the CRM.
   */
  async handlePayment(
    providerId: string,
    notification: PixPaymentNotification,
  ): Promise<Result<WhatsAppPixChargeDTO>> {
    const found = await WhatsAppPixChargeRepository.findByProviderCharge(
      providerId,
      notification.providerChargeId,
    )
    if (!found.ok) return found
    if (!found.value) return err(pixChargeNotFound())

    const paid = await WhatsAppPixChargeRepository.markPaid(found.value.id, {
      paidAt: notification.paidAt,
      paidAmount: notification.paidAmount,
      endToEndId: notification.endToEndId,
      payerName: notification.payerName,
    })
    if (!paid.ok) return paid
    // Already paid: the first notice did the work.
    if (!paid.value) return ok(toWhatsAppPixChargeDTO(found.value))

    const charge = paid.value
    const received = formatPixAmount(notification.paidAmount)
    const differs =
      Math.abs(notification.paidAmount - Number(charge.amount)) >= 0.005
    await WhatsAppConversationEventRepository.create({
      workspaceId: charge.workspaceId,
      conversationId: charge.conversationId,
      kind: 'PIX_PAID',
      source: 'PIX',
      reason: differs
        ? `${received} (cobrado ${formatPixAmount(Number(charge.amount))}) · ${charge.description}`
        : `${received} · ${charge.description}`,
    })

    auditMutation({
      entity: 'whatsapp_pix_charge',
      action: 'confirm',
      actorId: null,
      targetId: charge.id,
      meta: {
        workspaceId: charge.workspaceId,
        conversationId: charge.conversationId,
        provider: providerId,
        paidAmount: notification.paidAmount,
        amountMismatch: differs,
      },
    })

    await noteOnOpportunity(charge)
    await publishCharge(charge)
    return ok(toWhatsAppPixChargeDTO(charge))
  },

  /** Payment webhook: authenticate with the provider, then settle each. */
  async handleWebhook(
    providerId: string,
    headers: Headers,
    rawBody: string,
    query: URLSearchParams = new URLSearchParams(),
  ): Promise<Result<{ processed: number }>> {
    const provider = getPixProviderById(providerId)
    if (!provider.ok) return err(notFound('PixProvider'))
    const notifications = provider.value.parseWebhook(
      headers,
      rawBody,
      query,
    )
    if (!notifications.ok) return notifications

    let processed = 0
    for (const notification of notifications.value) {
      const result = await WhatsAppPixService.handlePayment(
        providerId,
        notification,
      )
      if (result.ok) {
        processed += 1
      } else if (result.error.code !== 'PIX_CHARGE_NOT_FOUND') {
        return result
      } else {
        logger.warn('whatsapp.pix.webhook_unknown_charge', {
          provider: providerId,
          providerChargeId: notification.providerChargeId,
        })
      }
    }
    return ok({ processed })
  },
}
