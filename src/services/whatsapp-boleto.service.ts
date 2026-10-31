import { randomBytes } from 'node:crypto'
import type { WhatsAppBoletoCharge } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  boletoChargeNotFound,
  boletoChargeNotPending,
  boletoDisabled,
  whatsappConnectionNotFound,
  whatsappConversationAiHandling,
} from '@/src/errors'
import type {
  BoletoNotification,
  BoletoProvider,
} from '@/src/lib/boleto/provider'
import { getActiveBoletoProvider } from '@/src/lib/boleto/registry'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toWhatsAppBoletoChargeDTO,
  toWhatsAppBoletoSettingsDTO,
} from '@/src/mappers/whatsapp-boleto.mapper'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  WhatsAppBoletoChargeRepository,
  WhatsAppBoletoSettingsRepository,
} from '@/src/repositories/whatsapp-boleto.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type {
  CreateWhatsAppBoletoChargeDTO,
  UpdateWhatsAppBoletoSettingsDTO,
} from '@/src/schemas/whatsapp-boleto.schema'
import type {
  WhatsAppBoletoChargeDTO,
  WhatsAppBoletoSettingsDTO,
} from '@/types/whatsapp-boleto'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { loadVisibleConversation } from './whatsapp-conversation-scope.service'
import {
  authorizeConversation,
  checkOpportunity,
  deliverText,
  formatPixAmount,
} from './whatsapp-pix.service'

const BOLETO_TIMEZONE = 'America/Sao_Paulo'
const MS_PER_DAY = 24 * 60 * 60 * 1000

const DUE_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BOLETO_TIMEZONE,
})

/** YYYY-MM-DD of an instant, read in São Paulo time. */
function isoDateInSaoPaulo(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOLETO_TIMEZONE,
  }).format(date)
}

/** First message of a boleto: what is being paid, the due date and the line. */
export function boletoMessageText(input: {
  amount: number
  description: string
  dueAt: Date
  barCode: string
  url: string | null
}): string {
  return [
    `*Boleto: ${formatPixAmount(input.amount)}*`,
    input.description,
    '',
    `Vencimento: ${DUE_DATE.format(input.dueAt)}.`,
    'Linha digitável:',
    input.barCode,
    ...(input.url ? ['', `Ver ou imprimir: ${input.url}`] : []),
  ].join('\n')
}

async function requireEnabled(
  workspaceId: string,
): Promise<Result<BoletoProvider>> {
  const settings =
    await WhatsAppBoletoSettingsRepository.findByWorkspace(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value?.enabled) return err(boletoDisabled())
  return getActiveBoletoProvider()
}

async function noteOnOpportunity(charge: WhatsAppBoletoCharge): Promise<void> {
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
    title: 'Boleto pago',
    body: `Boleto de ${formatPixAmount(Number(charge.paidAmount ?? charge.amount))} pago pelo WhatsApp: ${charge.description}.`,
  })
  if (!note.ok) {
    logger.warn('whatsapp.boleto.note_failed', {
      chargeId: charge.id,
      code: note.error.code,
    })
  }
}

export const WhatsAppBoletoService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBoletoSettingsDTO>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const settings =
      await WhatsAppBoletoSettingsRepository.findByWorkspace(workspaceId)
    if (!settings.ok) return settings
    const provider = getActiveBoletoProvider()
    if (!provider.ok) return provider
    return ok(
      toWhatsAppBoletoSettingsDTO(
        workspaceId,
        settings.value?.enabled ?? false,
        provider.value,
      ),
    )
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppBoletoSettingsDTO,
  ): Promise<Result<WhatsAppBoletoSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const provider = getActiveBoletoProvider()
    if (!provider.ok) return provider

    const saved = await WhatsAppBoletoSettingsRepository.upsert(workspaceId, {
      ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_boleto_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, ...dto },
    })
    return ok(
      toWhatsAppBoletoSettingsDTO(
        workspaceId,
        saved.value.enabled,
        provider.value,
      ),
    )
  },

  /** An agent sends a boleto to the contact of a conversation they can see. */
  async createCharge(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: CreateWhatsAppBoletoChargeDTO,
  ): Promise<Result<WhatsAppBoletoChargeDTO>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const provider = await requireEnabled(workspaceId)
    if (!provider.ok) return provider

    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation
    if (conversation.value.aiActive) {
      return err(whatsappConversationAiHandling())
    }

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

    const dueAtGuess = new Date(Date.now() + dto.dueInDays * MS_PER_DAY)
    const issued = await provider.value.createCharge({
      reference: randomBytes(16).toString('hex'),
      amount: dto.amount,
      description: dto.description,
      payer: { name: dto.payerName, taxId: dto.payerTaxId },
      dueDate: isoDateInSaoPaulo(dueAtGuess),
    })
    if (!issued.ok) return issued
    const dueAt = issued.value.dueAt ?? dueAtGuess

    const stored = await WhatsAppBoletoChargeRepository.create({
      workspaceId,
      conversationId,
      opportunityId: dto.opportunityId,
      createdById: actorId,
      provider: provider.value.id,
      providerChargeId: issued.value.providerChargeId,
      amount: dto.amount,
      description: dto.description,
      payerName: dto.payerName,
      payerTaxId: dto.payerTaxId,
      barCode: issued.value.barCode,
      url: issued.value.url,
      dueAt,
    })
    if (!stored.ok) return stored

    const sent = await deliverText(
      {
        workspaceId,
        conversation: conversation.value,
        connection: connection.value,
        actorId,
      },
      boletoMessageText({
        amount: dto.amount,
        description: dto.description,
        dueAt,
        barCode: issued.value.barCode,
        url: issued.value.url,
      }),
    )
    if (!sent.ok) {
      // Nothing reached the customer. AbacatePay has no cancel route, so the
      // boleto stays valid at the PSP; it is only closed on our side.
      await WhatsAppBoletoChargeRepository.markCanceled(stored.value.id)
      return sent
    }

    auditMutation({
      entity: 'whatsapp_boleto_charge',
      action: 'send',
      actorId,
      targetId: stored.value.id,
      meta: {
        workspaceId,
        conversationId,
        amount: dto.amount,
        opportunityId: dto.opportunityId ?? null,
      },
    })
    return ok(toWhatsAppBoletoChargeDTO(stored.value))
  },

  async listByConversation(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppBoletoChargeDTO[]>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope
    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const charges = await WhatsAppBoletoChargeRepository.listByConversation(
      conversationId,
      workspaceId,
    )
    if (!charges.ok) return charges
    return ok(charges.value.map((charge) => toWhatsAppBoletoChargeDTO(charge)))
  },

  /**
   * Closes a pending boleto on our side. The PSP has no cancel route: a boleto
   * paid afterwards still settles (the webhook wins).
   */
  async cancel(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    chargeId: string,
  ): Promise<Result<WhatsAppBoletoChargeDTO>> {
    const scope = await authorizeConversation(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const found = await WhatsAppBoletoChargeRepository.findById(
      chargeId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value || found.value.conversationId !== conversationId) {
      return err(boletoChargeNotFound())
    }
    if (toWhatsAppBoletoChargeDTO(found.value).status !== 'PENDING') {
      return err(boletoChargeNotPending())
    }

    const canceled = await WhatsAppBoletoChargeRepository.markCanceled(chargeId)
    if (!canceled.ok) return canceled
    if (!canceled.value) return err(boletoChargeNotPending())

    auditMutation({
      entity: 'whatsapp_boleto_charge',
      action: 'cancel',
      actorId,
      targetId: chargeId,
      meta: { workspaceId, conversationId },
    })
    return ok(toWhatsAppBoletoChargeDTO(canceled.value))
  },

  /**
   * Change reported by the PSP (already authenticated by the provider).
   * Idempotent: repeating a notice changes nothing.
   */
  async handleNotification(
    providerId: string,
    notification: BoletoNotification,
  ): Promise<Result<WhatsAppBoletoChargeDTO>> {
    const found = await WhatsAppBoletoChargeRepository.findByProviderCharge(
      providerId,
      notification.providerChargeId,
    )
    if (!found.ok) return found
    if (!found.value) return err(boletoChargeNotFound())

    if (notification.kind === 'PAID') {
      const paid = await WhatsAppBoletoChargeRepository.markPaid(found.value.id, {
        paidAt: notification.at,
        paidAmount: notification.amount ?? Number(found.value.amount),
      })
      if (!paid.ok) return paid
      if (!paid.value) return ok(toWhatsAppBoletoChargeDTO(found.value))

      auditMutation({
        entity: 'whatsapp_boleto_charge',
        action: 'confirm',
        actorId: null,
        targetId: paid.value.id,
        meta: {
          workspaceId: paid.value.workspaceId,
          conversationId: paid.value.conversationId,
          provider: providerId,
          paidAmount: notification.amount,
        },
      })
      await noteOnOpportunity(paid.value)
      return ok(toWhatsAppBoletoChargeDTO(paid.value))
    }

    const changed =
      notification.kind === 'REFUNDED'
        ? await WhatsAppBoletoChargeRepository.markRefunded(found.value.id)
        : await WhatsAppBoletoChargeRepository.markExpired(found.value.id)
    if (!changed.ok) return changed
    return ok(toWhatsAppBoletoChargeDTO(changed.value ?? found.value))
  },
}
