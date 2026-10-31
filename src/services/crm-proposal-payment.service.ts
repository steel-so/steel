import { createHash } from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import type { CrmProposalCharge } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  crmDealsPaymentDisabled,
  crmProposalChargeInvalid,
  crmProposalChargeNotFound,
  crmProposalSignatureNotFound,
  crmProposalSignatureRequired,
  forbidden,
  notFound,
  storageError,
} from '@/src/errors'
import {
  buildMockBoletoLine,
  CRM_PROPOSAL_BUCKET,
  decodeSignaturePng,
  formatChargeAmount,
  newChargeTxid,
  proposalSignatureKey,
  proposalSnapshot,
  sha256,
} from '@/src/lib/crm-deals'
import type {
  PixPaymentNotification,
  PixProvider,
} from '@/src/lib/pix/provider'
import {
  getActivePixProvider,
  getPixProviderById,
} from '@/src/lib/pix/registry'
import { err, ok, type Result } from '@/src/lib/result'
import {
  deleteObject,
  ensureBucket,
  getObject,
  putObject,
} from '@/src/lib/storage/s3'
import {
  toCrmProposalChargeDTO,
  toCrmProposalSignatureDTO,
  toPublicChargeDTOs,
} from '@/src/mappers/crm-deals.mapper'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import {
  CrmProposalChargeRepository,
  CrmProposalSignatureRepository,
} from '@/src/repositories/crm-proposal-payment.repository'
import {
  CrmProposalRepository,
  type CrmProposalWithSections,
} from '@/src/repositories/crm-proposal.repository'
import type {
  CreateCrmProposalChargeDTO,
  SignCrmProposalDTO,
} from '@/src/schemas/crm-deals.schema'
import type { AcceptCrmProposalDTO } from '@/src/schemas/crm-proposal.schema'
import type { CrmProposalPublicDTO } from '@/types/crm-proposal'
import type {
  CrmProposalChargeDTO,
  CrmProposalCheckoutDTO,
  CrmProposalPublicCheckoutDTO,
} from '@/types/crm-deals'
import {
  assertModuleEnabled,
  assertModuleMember,
  assertModulePrivileged,
} from './authz'
import { CrmDealsSettingsService } from './crm-deals-settings.service'
import { emitCrmOpportunityStageWebhooks } from './crm-opportunity-webhooks'
import { notifyCrmProposalPaid } from './crm-notifications'
import { CrmProposalService } from './crm-proposal.service'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Statuses of a proposal that may be charged (sent to the customer). */
const CHARGEABLE_STATUSES = ['SENT', 'VIEWED', 'ACCEPTED'] as const

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex')
}

function chargeDTO(charge: CrmProposalCharge): CrmProposalChargeDTO {
  const provider = getPixProviderById(charge.provider)
  return toCrmProposalChargeDTO(charge, provider.ok && provider.value.isTest)
}

async function loadProposal(
  workspaceId: string,
  proposalId: string,
): Promise<Result<CrmProposalWithSections>> {
  return CrmProposalRepository.findById(proposalId, workspaceId)
}

/**
 * Moves the deal of a paid charge to its first WON stage and notes the
 * payment on it. Never throws and never fails the payment: the money already
 * arrived, so any problem here is logged and the charge stays PAID.
 */
async function winDeal(
  charge: CrmProposalCharge,
): Promise<{ won: boolean; opportunityId: string | null }> {
  if (!charge.opportunityId) return { won: false, opportunityId: null }
  const opportunity = await CrmOpportunityRepository.findById(
    charge.opportunityId,
    charge.workspaceId,
  )
  if (!opportunity.ok) return { won: false, opportunityId: null }

  const stages = await CrmPipelineStageRepository.listByPipeline(
    opportunity.value.pipelineId,
  )
  const current = stages.ok
    ? stages.value.find((stage) => stage.id === opportunity.value.stageId)
    : undefined
  const target = stages.ok
    ? stages.value.find((stage) => stage.category === 'WON')
    : undefined

  let won = current?.category === 'WON'
  if (!won && target) {
    const now = new Date()
    const moved = await CrmOpportunityRepository.update(opportunity.value.id, {
      stageId: target.id,
      wonAt: opportunity.value.wonAt ?? now,
      stageChangedAt: now,
    })
    if (moved.ok) {
      won = true
      void emitCrmOpportunityStageWebhooks({
        workspaceId: charge.workspaceId,
        before: opportunity.value,
        after: moved.value,
        actorId: null,
      })
    } else {
      logger.warn('crm.proposal_payment.win_failed', {
        chargeId: charge.id,
        code: moved.error.code,
      })
    }
  } else if (!won) {
    logger.warn('crm.proposal_payment.no_won_stage', {
      chargeId: charge.id,
      pipelineId: opportunity.value.pipelineId,
    })
  }

  const label = formatChargeAmount(Number(charge.paidAmount ?? charge.amount))
  const note = await CrmNoteRepository.create({
    workspaceId: charge.workspaceId,
    createdById: charge.createdById ?? opportunity.value.createdById,
    opportunityId: opportunity.value.id,
    title: 'Pagamento da proposta recebido',
    body: `${label} recebido por ${charge.method === 'PIX' ? 'Pix' : 'boleto'}: ${charge.description}.`,
  })
  if (!note.ok) {
    logger.warn('crm.proposal_payment.note_failed', {
      chargeId: charge.id,
      code: note.error.code,
    })
  }
  return { won, opportunityId: opportunity.value.id }
}

/** Settings gate for the payment features. */
async function requirePaymentEnabled(workspaceId: string): Promise<Result<void>> {
  const settings = await CrmDealsSettingsService.resolve(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value.proposalPaymentEnabled) return err(crmDealsPaymentDisabled())
  return ok(undefined)
}

async function issue(
  provider: PixProvider,
  input: {
    proposal: CrmProposalWithSections
    actorId: string
    dto: CreateCrmProposalChargeDTO
    amount: number
    description: string
  },
): Promise<Result<CrmProposalCharge>> {
  const { proposal, dto, amount } = input
  if (dto.method === 'BOLETO' && !provider.isTest) {
    return err(
      crmProposalChargeInvalid('O provedor de pagamento atual não emite boleto'),
    )
  }
  const txid = newChargeTxid()
  const expiresAt = new Date(Date.now() + dto.expiresInDays * MS_PER_DAY)
  const issued = await provider.createCharge({
    txid,
    amount,
    description: input.description,
    expiresAt,
  })
  if (!issued.ok) return issued

  const stored = await CrmProposalChargeRepository.create({
    workspaceId: proposal.workspaceId,
    proposalId: proposal.id,
    opportunityId: proposal.opportunityId,
    createdById: input.actorId,
    method: dto.method,
    provider: provider.id,
    providerChargeId: issued.value.providerChargeId,
    amount,
    description: input.description,
    paymentCode:
      dto.method === 'PIX'
        ? issued.value.brCode
        : buildMockBoletoLine(txid, amount),
    expiresAt,
  })
  if (!stored.ok) {
    await provider.cancelCharge(issued.value.providerChargeId)
    return stored
  }
  return stored
}

/**
 * C6: electronic signature and Pix/boleto charge of a proposal. The PSP is
 * not chosen yet, so charges go through the `PixProvider` interface and only
 * the mock exists; the feature is OFF per workspace until an admin turns it
 * on (`proposalPaymentEnabled`). A paid charge wins the deal.
 */
export const CrmProposalPaymentService = {
  /** Charges and signatures of a proposal, for the seller's screen. */
  async checkout(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<CrmProposalCheckoutDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const proposal = await loadProposal(workspaceId, proposalId)
    if (!proposal.ok) return proposal

    const [settings, charges, signatures] = await Promise.all([
      CrmDealsSettingsService.resolve(workspaceId),
      CrmProposalChargeRepository.listByProposal(proposalId, workspaceId),
      CrmProposalSignatureRepository.listByProposal(proposalId, workspaceId),
    ])
    if (!settings.ok) return settings
    if (!charges.ok) return charges
    if (!signatures.ok) return signatures

    return ok({
      paymentEnabled: settings.value.proposalPaymentEnabled,
      signatureEnabled: settings.value.proposalSignatureEnabled,
      charges: charges.value.map(chargeDTO),
      signatures: signatures.value.map(toCrmProposalSignatureDTO),
    })
  },

  async createCharge(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    dto: CreateCrmProposalChargeDTO,
  ): Promise<Result<CrmProposalChargeDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const enabled = await requirePaymentEnabled(workspaceId)
    if (!enabled.ok) return enabled

    const proposal = await loadProposal(workspaceId, proposalId)
    if (!proposal.ok) return proposal
    if (
      !(CHARGEABLE_STATUSES as readonly string[]).includes(proposal.value.status)
    ) {
      return err(
        crmProposalChargeInvalid(
          'Só uma proposta já enviada ao cliente pode ser cobrada',
        ),
      )
    }

    let amount = dto.amount
    if (amount === undefined && proposal.value.opportunityId) {
      const deal = await CrmOpportunityRepository.findById(
        proposal.value.opportunityId,
        workspaceId,
      )
      if (!deal.ok) return deal
      amount = deal.value.amount === null ? undefined : Number(deal.value.amount)
    }
    if (amount === undefined || amount <= 0) {
      return err(
        crmProposalChargeInvalid(
          'Informe o valor da cobrança: a proposta não tem uma oportunidade com valor',
        ),
      )
    }

    const provider = getActivePixProvider()
    if (!provider.ok) return provider
    const description = (
      dto.description ?? `Proposta: ${proposal.value.name}`
    ).slice(0, 140)

    const stored = await issue(provider.value, {
      proposal: proposal.value,
      actorId,
      dto,
      amount,
      description,
    })
    if (!stored.ok) return stored

    auditMutation({
      entity: 'crm_proposal_charge',
      action: 'create',
      actorId,
      targetId: stored.value.id,
      meta: { workspaceId, proposalId, method: dto.method, amount },
    })
    return ok(chargeDTO(stored.value))
  },

  async cancelCharge(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    chargeId: string,
  ): Promise<Result<CrmProposalChargeDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const found = await CrmProposalChargeRepository.findById(
      chargeId,
      workspaceId,
    )
    if (!found.ok) return found
    if (found.value.proposalId !== proposalId) {
      return err(crmProposalChargeNotFound())
    }

    const canceled = await CrmProposalChargeRepository.markCanceled(chargeId)
    if (!canceled.ok) return canceled
    if (!canceled.value) {
      return err(
        crmProposalChargeInvalid(
          'Só uma cobrança aguardando pagamento pode ser cancelada',
        ),
      )
    }
    const provider = getPixProviderById(found.value.provider)
    if (provider.ok) {
      const stopped = await provider.value.cancelCharge(
        found.value.providerChargeId,
      )
      if (!stopped.ok) {
        logger.warn('crm.proposal_payment.cancel_at_provider_failed', {
          chargeId,
          code: stopped.error.code,
        })
      }
    }

    auditMutation({
      entity: 'crm_proposal_charge',
      action: 'cancel',
      actorId,
      targetId: chargeId,
      meta: { workspaceId, proposalId },
    })
    return ok(chargeDTO(canceled.value))
  },

  /**
   * Test providers only: settles the charge as if the customer paid it, so a
   * workspace can try the whole flow. OWNER/ADMIN.
   */
  async simulatePayment(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    chargeId: string,
  ): Promise<Result<CrmProposalChargeDTO>> {
    const privileged = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!privileged.ok) return privileged

    const found = await CrmProposalChargeRepository.findById(
      chargeId,
      workspaceId,
    )
    if (!found.ok) return found
    if (found.value.proposalId !== proposalId) {
      return err(crmProposalChargeNotFound())
    }
    const provider = getPixProviderById(found.value.provider)
    if (!provider.ok) return provider
    if (!provider.value.isTest) return err(forbidden())

    const paid = await CrmProposalPaymentService.handlePayment(
      provider.value.id,
      {
        providerChargeId: found.value.providerChargeId,
        paidAmount: Number(found.value.amount),
        paidAt: new Date(),
        endToEndId: null,
        payerName: null,
      },
    )
    if (!paid.ok) return paid

    auditMutation({
      entity: 'crm_proposal_charge',
      action: 'test',
      actorId,
      targetId: chargeId,
      meta: { workspaceId, proposalId, simulated: true },
    })
    return paid
  },

  /**
   * Payment notice from the PSP (already authenticated by the provider).
   * Idempotent: a repeated notice of a paid charge changes nothing. Marks the
   * charge paid, wins the deal and tells the proposal owner.
   */
  async handlePayment(
    providerId: string,
    notification: PixPaymentNotification,
  ): Promise<Result<CrmProposalChargeDTO>> {
    const found = await CrmProposalChargeRepository.findByProviderCharge(
      providerId,
      notification.providerChargeId,
    )
    if (!found.ok) return found
    if (!found.value) return err(crmProposalChargeNotFound())

    const paid = await CrmProposalChargeRepository.markPaid(found.value.id, {
      paidAt: notification.paidAt,
      paidAmount: notification.paidAmount,
      endToEndId: notification.endToEndId,
      payerName: notification.payerName,
    })
    if (!paid.ok) return paid
    // Already paid: the first notice did the work.
    if (!paid.value) return ok(chargeDTO(found.value))

    const charge = paid.value
    const outcome = await winDeal(charge)
    const proposal = await CrmProposalRepository.findById(
      charge.proposalId,
      charge.workspaceId,
    )
    if (proposal.ok) {
      void notifyCrmProposalPaid({
        workspaceId: charge.workspaceId,
        proposal: proposal.value,
        amountLabel: formatChargeAmount(notification.paidAmount),
        dealWon: outcome.won,
      })
    }

    auditMutation({
      entity: 'crm_proposal_charge',
      action: 'confirm',
      actorId: null,
      targetId: charge.id,
      meta: {
        workspaceId: charge.workspaceId,
        proposalId: charge.proposalId,
        provider: providerId,
        paidAmount: notification.paidAmount,
        dealWon: outcome.won,
      },
    })
    return ok(chargeDTO(charge))
  },

  /** Payment webhook: authenticate with the provider, then settle each notice. */
  async handleWebhook(
    providerId: string,
    headers: Headers,
    rawBody: string,
  ): Promise<Result<{ processed: number }>> {
    const provider = getPixProviderById(providerId)
    if (!provider.ok) return err(notFound('PixProvider'))
    const notifications = provider.value.parseWebhook(headers, rawBody)
    if (!notifications.ok) return notifications

    let processed = 0
    for (const notification of notifications.value) {
      const result = await CrmProposalPaymentService.handlePayment(
        providerId,
        notification,
      )
      if (result.ok) {
        processed += 1
      } else if (result.error.code !== 'CRM_PROPOSAL_CHARGE_NOT_FOUND') {
        return result
      } else {
        logger.warn('crm.proposal_payment.webhook_unknown_charge', {
          provider: providerId,
          providerChargeId: notification.providerChargeId,
        })
      }
    }
    return ok({ processed })
  },

  // ─── public page (the share token is the credential) ─────────────────────

  async getPublicCheckout(
    shareToken: string,
  ): Promise<Result<CrmProposalPublicCheckoutDTO>> {
    const proposal = await CrmProposalRepository.findByShareToken(shareToken)
    if (!proposal.ok) return proposal
    const enabled = await assertModuleEnabled(proposal.value.workspaceId, 'CRM')
    if (!enabled.ok) return enabled

    const [settings, signature, charges] = await Promise.all([
      CrmDealsSettingsService.resolve(proposal.value.workspaceId),
      CrmProposalSignatureRepository.latestByProposal(proposal.value.id),
      CrmProposalChargeRepository.listByProposal(
        proposal.value.id,
        proposal.value.workspaceId,
      ),
    ])
    if (!settings.ok) return settings
    if (!signature.ok) return signature
    if (!charges.ok) return charges

    return ok({
      signatureEnabled: settings.value.proposalSignatureEnabled,
      paymentEnabled: settings.value.proposalPaymentEnabled,
      signedBy: signature.value?.signerName ?? null,
      signedAt: signature.value ? signature.value.signedAt.toISOString() : null,
      charges: settings.value.proposalPaymentEnabled
        ? toPublicChargeDTOs(charges.value.map(chargeDTO))
        : [],
    })
  },

  /**
   * Plain acceptance by name. Refused when the workspace requires the digital
   * signature, so the switch cannot be bypassed by calling the API directly.
   */
  async accept(
    shareToken: string,
    ip: string,
    dto: AcceptCrmProposalDTO,
  ): Promise<Result<CrmProposalPublicDTO>> {
    const proposal = await CrmProposalRepository.findByShareToken(shareToken)
    if (!proposal.ok) return proposal
    const settings = await CrmDealsSettingsService.resolve(
      proposal.value.workspaceId,
    )
    if (!settings.ok) return settings
    if (settings.value.proposalSignatureEnabled) {
      return err(crmProposalSignatureRequired())
    }
    return CrmProposalService.accept(shareToken, ip, dto)
  },

  /**
   * The customer draws the signature: the proposal is accepted (same rules as
   * the plain acceptance: validity, status) and the PNG plus the SHA-256 of
   * the PNG and of the proposal content are kept as evidence.
   */
  async sign(
    shareToken: string,
    ip: string,
    dto: SignCrmProposalDTO,
  ): Promise<Result<CrmProposalPublicDTO>> {
    const proposal = await CrmProposalRepository.findByShareToken(shareToken)
    if (!proposal.ok) return proposal
    const { workspaceId } = proposal.value
    const enabled = await assertModuleEnabled(workspaceId, 'CRM')
    if (!enabled.ok) return enabled

    const settings = await CrmDealsSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings
    if (!settings.value.proposalSignatureEnabled) {
      return err(
        badRequest('A assinatura digital não está habilitada para esta proposta'),
      )
    }

    const png = decodeSignaturePng(dto.image)
    if (!png.ok) return png

    const id = createId()
    const storageKey = proposalSignatureKey(
      workspaceId,
      proposal.value.id,
      id,
    )
    try {
      await ensureBucket(CRM_PROPOSAL_BUCKET)
      await putObject({
        bucket: CRM_PROPOSAL_BUCKET,
        key: storageKey,
        body: png.value,
        contentType: 'image/png',
      })
    } catch (error) {
      logger.error('crm.proposal_signature.persist_failed', {
        workspaceId,
        proposalId: proposal.value.id,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(storageError('Falha ao armazenar a assinatura'))
    }

    const accepted = await CrmProposalService.accept(shareToken, ip, {
      name: dto.signerName,
    })
    if (!accepted.ok) {
      await deleteObject({ bucket: CRM_PROPOSAL_BUCKET, key: storageKey }).catch(
        () => undefined,
      )
      return accepted
    }

    const created = await CrmProposalSignatureRepository.create({
      id,
      workspaceId,
      proposalId: proposal.value.id,
      signerName: dto.signerName,
      signerDocument: dto.signerDocument ?? null,
      signerEmail: dto.signerEmail ?? null,
      storageKey,
      imageSha256: sha256(png.value),
      proposalSha256: sha256(proposalSnapshot(proposal.value)),
      ipHash: hashIp(ip),
      signedAt: new Date(),
    })
    if (!created.ok) return created

    // LGPD: the signer's name and document do not go to the log.
    auditMutation({
      entity: 'crm_proposal_signature',
      action: 'sign',
      actorId: null,
      targetId: id,
      meta: { workspaceId, proposalId: proposal.value.id, via: 'public_link' },
    })
    return accepted
  },

  /** PNG of a signature (the route serves it as `image/png`). */
  async signatureImage(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    signatureId: string,
  ): Promise<Result<Buffer>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const row = await CrmProposalSignatureRepository.findById(
      signatureId,
      proposalId,
      workspaceId,
    )
    if (!row.ok) return row
    try {
      return ok(
        await getObject({
          bucket: CRM_PROPOSAL_BUCKET,
          key: row.value.storageKey,
        }),
      )
    } catch {
      return err(crmProposalSignatureNotFound())
    }
  },
}
