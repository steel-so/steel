import type { WhatsAppConnection, WhatsAppContact } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import {
  type CatalogOrderPayload,
  type MetaOrderBlock,
  orderSummary,
  orderTotal,
  parseCatalogOrder,
} from '@/src/lib/whatsapp/catalog/order'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import {
  WhatsAppCatalogOrderRepository,
  WhatsAppCatalogProductRepository,
  WhatsAppCommerceSettingsRepository,
} from '@/src/repositories/whatsapp-catalog.repository'
import { assertModuleEnabled } from './authz'
import { CrmLeadService } from './crm-lead.service'
import { recordOutboundMessage } from './whatsapp-automation-send.service'
import { WhatsAppPixService } from './whatsapp-pix.service'

export interface InboundCatalogOrder {
  workspaceId: string
  connection: WhatsAppConnection
  contact: WhatsAppContact
  conversationId: string
  /** The inbound message row that carried the cart. */
  messageId: string
  providerMessageId: string
  order: MetaOrderBlock
}

export interface CatalogOrderOutcome {
  /** The cart is ours: the AI / chatbot stay quiet. */
  handled: boolean
  /** Timeline text of the cart, with the lines. */
  text?: string
  afterPublish?: () => Promise<void>
}

interface PricedLine {
  retailerId: string
  name: string
  quantity: number
  unitPrice: number
  crmProductId: string | null
}

/** Phone digits of the contact, when its identity key is a phone. */
function contactPhone(contact: WhatsAppContact): string | undefined {
  return /^\d+$/.test(contact.waId) ? contact.waId : undefined
}

async function priceLines(
  workspaceId: string,
  payload: CatalogOrderPayload,
): Promise<Result<PricedLine[]>> {
  const known = await WhatsAppCatalogProductRepository.findManyByRetailerIds(
    workspaceId,
    payload.items.map((item) => item.retailerId),
  )
  if (!known.ok) return known
  const byRetailer = new Map(known.value.map((p) => [p.retailerId, p]))
  return ok(
    payload.items.map((item) => {
      const product = byRetailer.get(item.retailerId)
      return {
        retailerId: item.retailerId,
        name: product?.name ?? item.retailerId,
        quantity: item.quantity,
        // The price the customer saw in the cart wins over our copy.
        unitPrice: item.unitPrice || Number(product?.price ?? 0),
        crmProductId: product?.source === 'CRM' ? product.externalId : null,
      }
    }),
  )
}

interface CrmOutcome {
  leadId: string | null
  opportunityId: string | null
}

/** Lead + deal for the cart. Failures are logged, never block the order. */
async function createCrmRecords(input: {
  workspaceId: string
  ownerUserId: string
  pipelineId: string | null
  contact: WhatsAppContact
  orderId: string
  lines: PricedLine[]
  total: number
}): Promise<CrmOutcome> {
  const outcome: CrmOutcome = { leadId: null, opportunityId: null }
  const { workspaceId, contact } = input
  const enabled = await assertModuleEnabled(workspaceId, 'CRM')
  if (!enabled.ok) return outcome

  const phone = contactPhone(contact)
  const name = contact.name ?? phone ?? 'Cliente do WhatsApp'
  if (phone) {
    const lead = await CrmLeadService.intake(
      workspaceId,
      {
        kind: 'system',
        createdById: input.ownerUserId,
        via: 'whatsapp_catalog',
        refId: input.orderId,
      },
      {
        name,
        phones: [phone],
        source: 'Catálogo do WhatsApp',
        channel: 'WhatsApp',
      },
    )
    if (lead.ok) outcome.leadId = lead.value.lead.id
    else {
      logger.warn('whatsapp.catalog.lead_failed', {
        workspaceId,
        reason: lead.error.code,
      })
    }
  }

  const pipeline = input.pipelineId
    ? await CrmPipelineRepository.findById(input.pipelineId, workspaceId)
    : await CrmPipelineRepository.findDefault(workspaceId)
  if (!pipeline.ok || !pipeline.value) return outcome
  const stages = await CrmPipelineStageRepository.listByPipeline(
    pipeline.value.id,
  )
  const firstStage = stages.ok ? stages.value[0] : undefined
  if (!firstStage) return outcome

  const opportunity = await CrmOpportunityRepository.create({
    workspaceId,
    createdById: input.ownerUserId,
    ownerId: input.ownerUserId,
    name: `Pedido pelo WhatsApp - ${name}`.slice(0, 200),
    amount: input.total,
    pipelineId: pipeline.value.id,
    stageId: firstStage.id,
    source: 'Catálogo do WhatsApp',
  })
  if (!opportunity.ok) {
    logger.warn('whatsapp.catalog.opportunity_failed', {
      workspaceId,
      reason: opportunity.error.code,
    })
    return outcome
  }
  outcome.opportunityId = opportunity.value.id

  for (const line of input.lines) {
    await CrmOpportunityLineItemRepository.create({
      opportunityId: opportunity.value.id,
      productId: line.crmProductId ?? undefined,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: 0,
      billingType: 'ONE_TIME',
    })
  }
  await CrmNoteRepository.create({
    workspaceId,
    createdById: input.ownerUserId,
    opportunityId: opportunity.value.id,
    title: 'Carrinho recebido pelo WhatsApp',
    body: orderSummary(input.lines, input.total),
  })
  return outcome
}

async function confirmToContact(
  input: InboundCatalogOrder,
  total: number,
): Promise<void> {
  const text = `Recebemos o seu carrinho (${new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(
    total,
  )}). Já avisamos a equipe e, em instantes, alguém confirma o pedido por aqui.`
  const sent = await WhatsAppSend.text(
    input.connection,
    { to: input.contact.waId, text },
    { cost: { source: 'OTHER', conversationId: input.conversationId } },
  )
  if (!sent.ok) {
    logger.warn('whatsapp.catalog.confirmation_failed', {
      conversationId: input.conversationId,
      reason: sent.error.code,
    })
    return
  }
  await recordOutboundMessage({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    type: 'TEXT',
    text,
    providerMessageId: sent.value.providerMessageId,
  })
}

export const WhatsAppCatalogOrderService = {
  /**
   * A cart (`order` message) from the catalog: stores it, creates the lead
   * and the deal, thanks the contact and, when the workspace asks, charges
   * the total over Pix (mock provider). `handled: false` = the catalog is
   * off or the cart was empty, so the message stays a plain one.
   */
  async handleInbound(
    input: InboundCatalogOrder,
  ): Promise<Result<CatalogOrderOutcome>> {
    const settings = await WhatsAppCommerceSettingsRepository.findByWorkspace(
      input.workspaceId,
    )
    if (!settings.ok) return settings
    if (!settings.value?.catalogEnabled) return ok({ handled: false })

    const payload = parseCatalogOrder(input.order)
    if (!payload) return ok({ handled: false })

    const lines = await priceLines(input.workspaceId, payload)
    if (!lines.ok) return lines
    const total = orderTotal(
      lines.value.map((l) => ({ ...l, currency: 'BRL' })),
    )

    const stored = await WhatsAppCatalogOrderRepository.create({
      workspaceId: input.workspaceId,
      contactId: input.contact.id,
      conversationId: input.conversationId,
      providerMessageId: input.providerMessageId,
      metaCatalogId: payload.catalogId,
      note: payload.note,
      items: lines.value.map(({ crmProductId: _skip, ...line }) => line),
      total,
      currency: payload.items[0].currency,
    })
    if (!stored.ok) return stored
    // A webhook retry: the first delivery did everything.
    if (!stored.value) return ok({ handled: true })

    let crm: CrmOutcome = { leadId: null, opportunityId: null }
    if (settings.value.orderCreatesOpportunity && settings.value.ownerUserId) {
      crm = await createCrmRecords({
        workspaceId: input.workspaceId,
        ownerUserId: settings.value.ownerUserId,
        pipelineId: settings.value.orderPipelineId,
        contact: input.contact,
        orderId: stored.value.id,
        lines: lines.value,
        total,
      })
    }

    const afterPublish = async () => {
      await confirmToContact(input, total)
      if (!settings.value?.orderPixEnabled) return
      const charge = await WhatsAppPixService.createChargeForAi({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        amount: total,
        description: `Pedido pelo WhatsApp (${lines.value.length} item${lines.value.length > 1 ? 'ns' : ''})`,
        opportunityId: crm.opportunityId ?? undefined,
      })
      if (!charge.ok) {
        logger.warn('whatsapp.catalog.pix_failed', {
          workspaceId: input.workspaceId,
          reason: charge.error.code,
        })
        return
      }
      await WhatsAppCatalogOrderRepository.update(stored.value.id, {
        pixChargeId: charge.value.id,
      })
    }

    await WhatsAppCatalogOrderRepository.update(stored.value.id, {
      leadId: crm.leadId,
      opportunityId: crm.opportunityId,
    })
    auditMutation({
      entity: 'whatsapp_catalog_order',
      action: 'create',
      actorId: null,
      targetId: stored.value.id,
      meta: {
        workspaceId: input.workspaceId,
        items: lines.value.length,
        total,
        lead: Boolean(crm.leadId),
        opportunity: Boolean(crm.opportunityId),
      },
    })
    return ok({
      handled: true,
      text: orderSummary(lines.value, total),
      afterPublish,
    })
  },
}
