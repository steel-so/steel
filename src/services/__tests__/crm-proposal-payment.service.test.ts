import { Prisma, type Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCrmProposalCharge,
  createFakeCrmProposalSignature,
} from '@/src/__tests__/factories/nov-crm-deals.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmProposalExpired,
  databaseError,
  pixProviderError,
  pixWebhookInvalid,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-proposal-payment.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('../crm-deals-settings.service')
vi.mock('../crm-proposal.service')
vi.mock('../crm-notifications')
vi.mock('../crm-opportunity-webhooks')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/storage/s3', () => ({
  deleteObject: vi.fn(),
  ensureBucket: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
}))
vi.mock('@/src/lib/boleto/registry', () => ({
  getActiveBoletoProvider: vi.fn(),
}))
vi.mock('@/src/lib/pix/registry', () => ({
  getActivePixProvider: vi.fn(),
  getPixProviderById: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { getActiveBoletoProvider } from '@/src/lib/boleto/registry'
import {
  getActivePixProvider,
  getPixProviderById,
} from '@/src/lib/pix/registry'
import {
  deleteObject,
  ensureBucket,
  getObject,
  putObject,
} from '@/src/lib/storage/s3'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import {
  CrmProposalChargeRepository,
  CrmProposalSignatureRepository,
} from '@/src/repositories/crm-proposal-payment.repository'
import { CrmProposalRepository } from '@/src/repositories/crm-proposal.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmDealsSettingsService } from '../crm-deals-settings.service'
import { notifyCrmProposalPaid } from '../crm-notifications'
import { emitCrmOpportunityStageWebhooks } from '../crm-opportunity-webhooks'
import { CrmProposalPaymentService as Service } from '../crm-proposal-payment.service'
import { CrmProposalService } from '../crm-proposal.service'

const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)
const charges = vi.mocked(CrmProposalChargeRepository)
const signatures = vi.mocked(CrmProposalSignatureRepository)
const proposals = vi.mocked(CrmProposalRepository)
const deals = vi.mocked(CrmOpportunityRepository)
const stages = vi.mocked(CrmPipelineStageRepository)
const notes = vi.mocked(CrmNoteRepository)
const settings = vi.mocked(CrmDealsSettingsService)
const proposalService = vi.mocked(CrmProposalService)
const activeProvider = vi.mocked(getActivePixProvider)
const providerById = vi.mocked(getPixProviderById)

const activeBoleto = vi.mocked(getActiveBoletoProvider)
const boletoProvider = {
  id: 'mock',
  isTest: true,
  createCharge: vi.fn(),
  getChargeStatus: vi.fn(),
  parseWebhook: vi.fn(),
}

const provider = {
  id: 'mock',
  isTest: true,
  createCharge: vi.fn(),
  cancelCharge: vi.fn(),
  parseWebhook: vi.fn(),
}

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const withSettings = (overrides = {}) =>
  settings.resolve.mockResolvedValue(
    ok({
      proposalPaymentEnabled: true,
      proposalSignatureEnabled: false,
      renewalLeadDays: 60,
      renewalAutoCreate: true,
      ...overrides,
    }),
  )

function sentProposal(overrides = {}) {
  return {
    ...createFakeCrmProposal({
      id: 'p1',
      workspaceId: 'ws',
      status: 'SENT',
      opportunityId: 'o1',
      ...overrides,
    }),
    sections: [],
  }
}

function stage(id: string, category: 'OPEN' | 'WON' | 'LOST', position = 0) {
  const now = new Date()
  return {
    id,
    pipelineId: 'pipe',
    name: id,
    position,
    probability: 0,
    category,
    color: null,
    createdAt: now,
    updatedAt: now,
  }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('signature'),
])
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`

beforeEach(() => {
  vi.resetAllMocks()
  access.isEnabled.mockResolvedValue(ok(true))
  asRole('OWNER')
  withSettings()
  activeProvider.mockReturnValue(ok(provider))
  providerById.mockReturnValue(ok(provider))
  activeBoleto.mockReturnValue(ok(boletoProvider as never))
  boletoProvider.isTest = true
  boletoProvider.createCharge.mockResolvedValue(
    ok({
      providerChargeId: 'bol1',
      barCode: 'REAL-LINE',
      url: null,
      brCode: null,
      dueAt: null,
    }),
  )
  provider.createCharge.mockResolvedValue(
    ok({ providerChargeId: 'txid1', brCode: 'BR-CODE' }),
  )
  provider.cancelCharge.mockResolvedValue(ok(undefined))
  provider.isTest = true
  notes.create.mockResolvedValue(ok({} as never))
})

describe('checkout', () => {
  it('lists charges and signatures with the switches', async () => {
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    charges.listByProposal.mockResolvedValue(
      ok([createFakeCrmProposalCharge({ proposalId: 'p1' })]),
    )
    signatures.listByProposal.mockResolvedValue(
      ok([createFakeCrmProposalSignature({ proposalId: 'p1' })]),
    )
    const dto = expectOk(await Service.checkout('u', 'ws', 'p1'))
    expect(dto.paymentEnabled).toBe(true)
    expect(dto.charges).toHaveLength(1)
    expect(dto.charges[0]?.isTest).toBe(true)
    expect(dto.signatures).toHaveLength(1)
  })

  it('refuses a non-member and a missing proposal', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.checkout('u', 'ws', 'p1'), 'FORBIDDEN')
    asRole('OWNER')
    proposals.findById.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.checkout('u', 'ws', 'p1'), 'CRM_PROPOSAL_NOT_FOUND')
  })

  it.each([
    ['settings', () => settings.resolve.mockResolvedValue(err(databaseError('x')))],
    ['charges', () => charges.listByProposal.mockResolvedValue(err(databaseError('x')))],
    ['signatures', () => signatures.listByProposal.mockResolvedValue(err(databaseError('x')))],
  ])('propagates a failure reading the %s', async (_name, fail) => {
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    charges.listByProposal.mockResolvedValue(ok([]))
    signatures.listByProposal.mockResolvedValue(ok([]))
    fail()
    expectErr(await Service.checkout('u', 'ws', 'p1'), 'DATABASE_ERROR')
  })
})

describe('createCharge', () => {
  const dto = { method: 'PIX' as const, expiresInDays: 7 }

  beforeEach(() => {
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ id: 'o1', amount: new Prisma.Decimal(900) })),
    )
    charges.create.mockImplementation(async (data) =>
      ok(createFakeCrmProposalCharge({ ...data, amount: new Prisma.Decimal(data.amount) })),
    )
  })

  it('issues a Pix with the amount of the deal and audits it', async () => {
    const result = expectOk(await Service.createCharge('u', 'ws', 'p1', dto))
    expect(result.amount).toBe(900)
    expect(result.method).toBe('PIX')
    expect(provider.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 900,
        description: expect.stringContaining('Proposta: '),
      }),
    )
    expect(charges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentCode: 'BR-CODE',
        opportunityId: 'o1',
        provider: 'mock',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_proposal_charge', action: 'create' }),
    )
  })

  it('uses the given amount and caps the description at 140 characters', async () => {
    const result = expectOk(
      await Service.createCharge('u', 'ws', 'p1', {
        ...dto,
        amount: 50,
        description: 'x'.repeat(200),
      }),
    )
    expect(result.amount).toBe(50)
    expect(result.description).toHaveLength(140)
    expect(deals.findById).not.toHaveBeenCalled()
  })

  it('builds a test boleto line for BOLETO through the boleto provider', async () => {
    expectOk(
      await Service.createCharge('u', 'ws', 'p1', { ...dto, method: 'BOLETO' }),
    )
    const stored = charges.create.mock.calls[0]?.[0]
    expect(stored?.method).toBe('BOLETO')
    expect(stored?.providerChargeId).toBe('bol1')
    expect(stored?.paymentCode.startsWith('999')).toBe(true)
    expect(provider.createCharge).not.toHaveBeenCalled()
  })

  it('needs the payer to issue a real boleto, then stores the PSP line', async () => {
    boletoProvider.isTest = false
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', { ...dto, method: 'BOLETO' }),
      'CRM_PROPOSAL_CHARGE_INVALID',
    )
    expect(boletoProvider.createCharge).not.toHaveBeenCalled()

    expectOk(
      await Service.createCharge('u', 'ws', 'p1', {
        ...dto,
        method: 'BOLETO',
        payerName: 'Maria',
        payerTaxId: '11144477735',
      }),
    )
    expect(charges.create.mock.calls[0]?.[0].paymentCode).toBe('REAL-LINE')
    expect(boletoProvider.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        payer: { name: 'Maria', taxId: '11144477735' },
      }),
    )
  })

  it('passes on boleto provider failures and survives a storage failure', async () => {
    activeBoleto.mockReturnValueOnce(err(pixProviderError()))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', { ...dto, method: 'BOLETO' }),
      'PIX_PROVIDER_ERROR',
    )
    boletoProvider.createCharge.mockResolvedValueOnce(err(pixProviderError()))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', { ...dto, method: 'BOLETO' }),
      'PIX_PROVIDER_ERROR',
    )
    charges.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', { ...dto, method: 'BOLETO' }),
      'DATABASE_ERROR',
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.proposal_payment.boleto_orphaned',
      expect.anything(),
    )
  })

  it('is off by default', async () => {
    withSettings({ proposalPaymentEnabled: false })
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'CRM_DEALS_PAYMENT_DISABLED',
    )
  })

  it('needs a proposal that already went to the customer', async () => {
    proposals.findById.mockResolvedValue(ok(sentProposal({ status: 'DRAFT' })))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'CRM_PROPOSAL_CHARGE_INVALID',
    )
  })

  it('needs an amount from somewhere', async () => {
    proposals.findById.mockResolvedValue(ok(sentProposal({ opportunityId: null })))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'CRM_PROPOSAL_CHARGE_INVALID',
    )
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ id: 'o1', amount: null })),
    )
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'CRM_PROPOSAL_CHARGE_INVALID',
    )
  })

  it('propagates the lookups and the provider failing', async () => {
    deals.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.createCharge('u', 'ws', 'p1', dto), 'DATABASE_ERROR')
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ amount: new Prisma.Decimal(10) })),
    )
    activeProvider.mockReturnValue(err(pixProviderError()))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'PIX_PROVIDER_ERROR',
    )
    activeProvider.mockReturnValue(ok(provider))
    provider.createCharge.mockResolvedValue(err(pixProviderError()))
    expectErr(
      await Service.createCharge('u', 'ws', 'p1', dto),
      'PIX_PROVIDER_ERROR',
    )
  })

  it('cancels at the provider when the charge cannot be stored', async () => {
    charges.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.createCharge('u', 'ws', 'p1', dto), 'DATABASE_ERROR')
    expect(provider.cancelCharge).toHaveBeenCalledWith('txid1')
  })

  it('rejects a viewer', async () => {
    asRole('VIEWER')
    expectErr(await Service.createCharge('u', 'ws', 'p1', dto), 'FORBIDDEN')
  })
})

describe('cancelCharge', () => {
  it('cancels a pending charge and stops it at the provider', async () => {
    const charge = createFakeCrmProposalCharge({ id: 'c1', proposalId: 'p1' })
    charges.findById.mockResolvedValue(ok(charge))
    charges.markCanceled.mockResolvedValue(
      ok({ ...charge, status: 'CANCELED' as const }),
    )
    const dto = expectOk(await Service.cancelCharge('u', 'ws', 'p1', 'c1'))
    expect(dto.status).toBe('CANCELED')
    expect(provider.cancelCharge).toHaveBeenCalledWith(charge.providerChargeId)
  })

  it('logs but succeeds when the provider fails to cancel', async () => {
    const charge = createFakeCrmProposalCharge({ id: 'c1', proposalId: 'p1' })
    charges.findById.mockResolvedValue(ok(charge))
    charges.markCanceled.mockResolvedValue(ok({ ...charge, status: 'CANCELED' as const }))
    provider.cancelCharge.mockResolvedValue(err(pixProviderError()))
    expectOk(await Service.cancelCharge('u', 'ws', 'p1', 'c1'))
    expect(logger.warn).toHaveBeenCalled()
  })

  it('skips the provider when it is unknown', async () => {
    const charge = createFakeCrmProposalCharge({ id: 'c1', proposalId: 'p1' })
    charges.findById.mockResolvedValue(ok(charge))
    charges.markCanceled.mockResolvedValue(ok({ ...charge, status: 'CANCELED' as const }))
    providerById.mockReturnValue(err(pixProviderError()))
    expectOk(await Service.cancelCharge('u', 'ws', 'p1', 'c1'))
    expect(provider.cancelCharge).not.toHaveBeenCalled()
  })

  it('does not find a charge of another proposal', async () => {
    charges.findById.mockResolvedValue(
      ok(createFakeCrmProposalCharge({ proposalId: 'other' })),
    )
    expectErr(
      await Service.cancelCharge('u', 'ws', 'p1', 'c1'),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )
  })

  it('only cancels a pending charge', async () => {
    charges.findById.mockResolvedValue(
      ok(createFakeCrmProposalCharge({ proposalId: 'p1', status: 'PAID' })),
    )
    charges.markCanceled.mockResolvedValue(ok(null))
    expectErr(
      await Service.cancelCharge('u', 'ws', 'p1', 'c1'),
      'CRM_PROPOSAL_CHARGE_INVALID',
    )
  })

  it('propagates repository failures and denies a viewer', async () => {
    charges.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.cancelCharge('u', 'ws', 'p1', 'c1'), 'DATABASE_ERROR')
    charges.findById.mockResolvedValue(
      ok(createFakeCrmProposalCharge({ proposalId: 'p1' })),
    )
    charges.markCanceled.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.cancelCharge('u', 'ws', 'p1', 'c1'), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.cancelCharge('u', 'ws', 'p1', 'c1'), 'FORBIDDEN')
  })
})

describe('simulatePayment', () => {
  const charge = createFakeCrmProposalCharge({
    id: 'c1',
    proposalId: 'p1',
    workspaceId: 'ws',
    providerChargeId: 'txid1',
    opportunityId: null,
  })

  beforeEach(() => {
    charges.findById.mockResolvedValue(ok(charge))
    charges.findByProviderCharge.mockResolvedValue(ok(charge))
    charges.markPaid.mockResolvedValue(ok({ ...charge, status: 'PAID' as const }))
    proposals.findById.mockResolvedValue(ok(sentProposal()))
  })

  it('settles the charge through the same path as the webhook', async () => {
    const dto = expectOk(await Service.simulatePayment('u', 'ws', 'p1', 'c1'))
    expect(dto.status).toBe('PAID')
    expect(charges.markPaid).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ paidAmount: 1500 }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'test' }),
    )
  })

  it('is for admins only', async () => {
    asRole('MEMBER')
    expectErr(await Service.simulatePayment('u', 'ws', 'p1', 'c1'), 'FORBIDDEN')
  })

  it('never settles a charge of a real provider', async () => {
    provider.isTest = false
    expectErr(await Service.simulatePayment('u', 'ws', 'p1', 'c1'), 'FORBIDDEN')
  })

  it('checks the charge, the proposal and the provider', async () => {
    charges.findById.mockResolvedValue(
      ok(createFakeCrmProposalCharge({ proposalId: 'other' })),
    )
    expectErr(
      await Service.simulatePayment('u', 'ws', 'p1', 'c1'),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )
    charges.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.simulatePayment('u', 'ws', 'p1', 'c1'), 'DATABASE_ERROR')
    charges.findById.mockResolvedValue(ok(charge))
    providerById.mockReturnValue(err(pixProviderError()))
    expectErr(
      await Service.simulatePayment('u', 'ws', 'p1', 'c1'),
      'PIX_PROVIDER_ERROR',
    )
  })

  it('propagates a failure while settling', async () => {
    charges.markPaid.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.simulatePayment('u', 'ws', 'p1', 'c1'), 'DATABASE_ERROR')
  })
})

describe('handlePayment', () => {
  const notice = {
    providerChargeId: 'txid1',
    paidAmount: 900,
    paidAt: new Date('2026-10-30T12:00:00Z'),
    endToEndId: 'E2E',
    payerName: 'Ana',
  }
  const pending = createFakeCrmProposalCharge({
    id: 'c1',
    workspaceId: 'ws',
    proposalId: 'p1',
    opportunityId: 'o1',
    providerChargeId: 'txid1',
  })
  const paid = {
    ...pending,
    status: 'PAID' as const,
    paidAmount: new Prisma.Decimal(900),
  }
  const deal = createFakeCrmOpportunity({
    id: 'o1',
    workspaceId: 'ws',
    pipelineId: 'pipe',
    stageId: 's-open',
  })

  beforeEach(() => {
    charges.findByProviderCharge.mockResolvedValue(ok(pending))
    charges.markPaid.mockResolvedValue(ok(paid))
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    deals.findById.mockResolvedValue(ok(deal))
    stages.listByPipeline.mockResolvedValue(
      ok([stage('s-open', 'OPEN'), stage('s-won', 'WON', 1)]),
    )
    deals.update.mockResolvedValue(ok({ ...deal, stageId: 's-won' }))
  })

  it('wins the deal, notes it, notifies the owner and audits', async () => {
    const dto = expectOk(await Service.handlePayment('mock', notice))
    expect(dto.status).toBe('PAID')
    expect(deals.update).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ stageId: 's-won', wonAt: expect.any(Date) }),
    )
    expect(emitCrmOpportunityStageWebhooks).toHaveBeenCalled()
    expect(notes.create).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 'o1' }),
    )
    expect(notifyCrmProposalPaid).toHaveBeenCalledWith(
      expect.objectContaining({ dealWon: true }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'confirm', actorId: null }),
    )
  })

  it('is idempotent: a second notice changes nothing', async () => {
    charges.markPaid.mockResolvedValue(ok(null))
    expectOk(await Service.handlePayment('mock', notice))
    expect(deals.update).not.toHaveBeenCalled()
    expect(notifyCrmProposalPaid).not.toHaveBeenCalled()
  })

  it('answers not found for a charge it does not know', async () => {
    charges.findByProviderCharge.mockResolvedValue(ok(null))
    expectErr(
      await Service.handlePayment('mock', notice),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )
    charges.findByProviderCharge.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.handlePayment('mock', notice), 'DATABASE_ERROR')
    charges.findByProviderCharge.mockResolvedValue(ok(pending))
    charges.markPaid.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.handlePayment('mock', notice), 'DATABASE_ERROR')
  })

  it('records the payment even when the charge has no deal', async () => {
    charges.markPaid.mockResolvedValue(ok({ ...paid, opportunityId: null }))
    expectOk(await Service.handlePayment('mock', notice))
    expect(deals.update).not.toHaveBeenCalled()
    expect(notifyCrmProposalPaid).toHaveBeenCalledWith(
      expect.objectContaining({ dealWon: false }),
    )
  })

  it('leaves a deal that is already won where it is', async () => {
    stages.listByPipeline.mockResolvedValue(
      ok([stage('s-open', 'OPEN'), stage('s-won', 'WON', 1)]),
    )
    deals.findById.mockResolvedValue(ok({ ...deal, stageId: 's-won' }))
    expectOk(await Service.handlePayment('mock', notice))
    expect(deals.update).not.toHaveBeenCalled()
    expect(notifyCrmProposalPaid).toHaveBeenCalledWith(
      expect.objectContaining({ dealWon: true }),
    )
  })

  it('keeps the payment when the pipeline has no won stage', async () => {
    stages.listByPipeline.mockResolvedValue(ok([stage('s-open', 'OPEN')]))
    expectOk(await Service.handlePayment('mock', notice))
    expect(deals.update).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.proposal_payment.no_won_stage',
      expect.anything(),
    )
    expect(notifyCrmProposalPaid).toHaveBeenCalledWith(
      expect.objectContaining({ dealWon: false }),
    )
  })

  it('keeps the payment when the stages cannot be read or the move fails', async () => {
    stages.listByPipeline.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.handlePayment('mock', notice))
    stages.listByPipeline.mockResolvedValue(
      ok([stage('s-open', 'OPEN'), stage('s-won', 'WON', 1)]),
    )
    deals.update.mockResolvedValue(err(databaseError('x')))
    notes.create.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.handlePayment('mock', notice))
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.proposal_payment.win_failed',
      expect.anything(),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.proposal_payment.note_failed',
      expect.anything(),
    )
  })

  it('keeps the payment when the deal is gone and skips the owner notice if the proposal is', async () => {
    deals.findById.mockResolvedValue(err(databaseError('x')))
    proposals.findById.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.handlePayment('mock', notice))
    expect(notifyCrmProposalPaid).not.toHaveBeenCalled()
  })

  it('falls back to the paid-by user, then to the deal creator, for the note', async () => {
    charges.markPaid.mockResolvedValue(ok({ ...paid, createdById: null, paidAmount: null }))
    expectOk(await Service.handlePayment('mock', notice))
    expect(notes.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: deal.createdById }),
    )
  })
})

describe('handleWebhook', () => {
  const notice = {
    providerChargeId: 'txid1',
    paidAmount: 10,
    paidAt: new Date(),
    endToEndId: null,
    payerName: null,
  }

  it('rejects an unknown provider and a bad signature', async () => {
    providerById.mockReturnValue(err(pixProviderError()))
    expectErr(
      await Service.handleWebhook('x', new Headers(), '{}'),
      'RESOURCE_NOT_FOUND',
    )
    providerById.mockReturnValue(ok(provider))
    provider.parseWebhook.mockReturnValue(err(pixWebhookInvalid()))
    expectErr(
      await Service.handleWebhook('mock', new Headers(), '{}'),
      'PIX_WEBHOOK_INVALID',
    )
  })

  it('counts the settled notices and skips charges of other flows', async () => {
    provider.parseWebhook.mockReturnValue(
      ok([notice, { ...notice, providerChargeId: 'other' }]),
    )
    const charge = createFakeCrmProposalCharge({ opportunityId: null })
    charges.findByProviderCharge.mockImplementation(async (_p, id) =>
      ok(id === 'txid1' ? charge : null),
    )
    charges.markPaid.mockResolvedValue(ok({ ...charge, status: 'PAID' as const }))
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    const result = expectOk(
      await Service.handleWebhook('mock', new Headers(), '{}'),
    )
    expect(result.processed).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.proposal_payment.webhook_unknown_charge',
      expect.anything(),
    )
  })

  it('stops at a real failure', async () => {
    provider.parseWebhook.mockReturnValue(ok([notice]))
    charges.findByProviderCharge.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.handleWebhook('mock', new Headers(), '{}'),
      'DATABASE_ERROR',
    )
  })
})

describe('getPublicCheckout', () => {
  beforeEach(() => {
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    signatures.latestByProposal.mockResolvedValue(
      ok(createFakeCrmProposalSignature({ signerName: 'Carlos' })),
    )
    charges.listByProposal.mockResolvedValue(
      ok([
        createFakeCrmProposalCharge({ status: 'PENDING' }),
        createFakeCrmProposalCharge({ status: 'CANCELED' }),
      ]),
    )
  })

  it('shows who signed and the payable charges', async () => {
    const dto = expectOk(await Service.getPublicCheckout('tok'))
    expect(dto.signedBy).toBe('Carlos')
    expect(dto.paymentEnabled).toBe(true)
    expect(dto.charges).toHaveLength(1)
  })

  it('hides the charges when the payment is off and tolerates no signature', async () => {
    withSettings({ proposalPaymentEnabled: false })
    signatures.latestByProposal.mockResolvedValue(ok(null))
    const dto = expectOk(await Service.getPublicCheckout('tok'))
    expect(dto.charges).toEqual([])
    expect(dto.signedBy).toBeNull()
    expect(dto.signedAt).toBeNull()
  })

  it('fails closed on a missing proposal, a disabled module and read errors', async () => {
    proposals.findByShareToken.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.getPublicCheckout('tok'), 'CRM_PROPOSAL_NOT_FOUND')
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(await Service.getPublicCheckout('tok'), 'MODULE_DISABLED')
    access.isEnabled.mockResolvedValue(ok(true))
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.getPublicCheckout('tok'), 'DATABASE_ERROR')
    withSettings()
    signatures.latestByProposal.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.getPublicCheckout('tok'), 'DATABASE_ERROR')
    signatures.latestByProposal.mockResolvedValue(ok(null))
    charges.listByProposal.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.getPublicCheckout('tok'), 'DATABASE_ERROR')
  })
})

describe('accept', () => {
  it('delegates to the plain acceptance when no signature is required', async () => {
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    proposalService.accept.mockResolvedValue(ok({} as never))
    expectOk(await Service.accept('tok', '1.1.1.1', { name: 'Ana' }))
    expect(proposalService.accept).toHaveBeenCalledWith('tok', '1.1.1.1', {
      name: 'Ana',
    })
  })

  it('refuses the plain acceptance when the workspace wants a signature', async () => {
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    withSettings({ proposalSignatureEnabled: true })
    expectErr(
      await Service.accept('tok', '1.1.1.1', { name: 'Ana' }),
      'CRM_PROPOSAL_SIGNATURE_REQUIRED',
    )
    expect(proposalService.accept).not.toHaveBeenCalled()
  })

  it('propagates a missing proposal and a settings failure', async () => {
    proposals.findByShareToken.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.accept('tok', 'ip', { name: 'Ana' }),
      'CRM_PROPOSAL_NOT_FOUND',
    )
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.accept('tok', 'ip', { name: 'Ana' }), 'DATABASE_ERROR')
  })
})

describe('sign', () => {
  const dto = { signerName: 'Carlos Lima', image: PNG_URL }

  beforeEach(() => {
    withSettings({ proposalSignatureEnabled: true })
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    proposalService.accept.mockResolvedValue(ok({ status: 'ACCEPTED' } as never))
    signatures.create.mockImplementation(async (data) =>
      ok(createFakeCrmProposalSignature(data)),
    )
  })

  it('stores the PNG, accepts the proposal and keeps both hashes', async () => {
    const result = expectOk(await Service.sign('tok', '1.2.3.4', dto))
    expect(result).toEqual({ status: 'ACCEPTED' })
    expect(ensureBucket).toHaveBeenCalledWith('crm-proposals')
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    )
    const saved = signatures.create.mock.calls[0]?.[0]
    expect(saved?.imageSha256).toHaveLength(64)
    expect(saved?.proposalSha256).toHaveLength(64)
    expect(saved?.ipHash).toHaveLength(64)
    expect(saved?.ipHash).not.toContain('1.2.3.4')
    expect(proposalService.accept).toHaveBeenCalledWith('tok', '1.2.3.4', {
      name: 'Carlos Lima',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_proposal_signature', action: 'sign' }),
    )
  })

  it('needs the switch on', async () => {
    withSettings({ proposalSignatureEnabled: false })
    expectErr(await Service.sign('tok', 'ip', dto), 'BAD_REQUEST')
  })

  it('refuses an image that is not a PNG, before storing anything', async () => {
    expectErr(
      await Service.sign('tok', 'ip', {
        ...dto,
        image: `data:image/png;base64,${Buffer.from('not a png file').toString('base64')}`,
      }),
      'VALIDATION_ERROR',
    )
    expect(putObject).not.toHaveBeenCalled()
  })

  it('reports a storage failure', async () => {
    vi.mocked(putObject).mockRejectedValue(new Error('minio down'))
    expectErr(await Service.sign('tok', 'ip', dto), 'STORAGE_ERROR')
    expect(proposalService.accept).not.toHaveBeenCalled()
    vi.mocked(putObject).mockRejectedValue('weird')
    expectErr(await Service.sign('tok', 'ip', dto), 'STORAGE_ERROR')
  })

  it('removes the stored image when the proposal cannot be accepted', async () => {
    proposalService.accept.mockResolvedValue(err(crmProposalExpired('vencida')))
    vi.mocked(deleteObject).mockRejectedValue(new Error('x'))
    expectErr(await Service.sign('tok', 'ip', dto), 'CRM_PROPOSAL_EXPIRED')
    expect(deleteObject).toHaveBeenCalled()
    expect(signatures.create).not.toHaveBeenCalled()
  })

  it('propagates the lookups and the signature row failing', async () => {
    proposals.findByShareToken.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.sign('tok', 'ip', dto), 'CRM_PROPOSAL_NOT_FOUND')
    proposals.findByShareToken.mockResolvedValue(ok(sentProposal()))
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(await Service.sign('tok', 'ip', dto), 'MODULE_DISABLED')
    access.isEnabled.mockResolvedValue(ok(true))
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.sign('tok', 'ip', dto), 'DATABASE_ERROR')
    withSettings({ proposalSignatureEnabled: true })
    signatures.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.sign('tok', 'ip', dto), 'DATABASE_ERROR')
  })
})

describe('signatureImage', () => {
  it('returns the stored PNG', async () => {
    signatures.findById.mockResolvedValue(ok(createFakeCrmProposalSignature()))
    vi.mocked(getObject).mockResolvedValue(PNG)
    expect(expectOk(await Service.signatureImage('u', 'ws', 'p1', 's1'))).toBe(PNG)
  })

  it('answers not found when the object is gone', async () => {
    signatures.findById.mockResolvedValue(ok(createFakeCrmProposalSignature()))
    vi.mocked(getObject).mockRejectedValue(new Error('NoSuchKey'))
    expectErr(
      await Service.signatureImage('u', 'ws', 'p1', 's1'),
      'CRM_PROPOSAL_SIGNATURE_NOT_FOUND',
    )
  })

  it('checks access and the row', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.signatureImage('u', 'ws', 'p1', 's1'), 'FORBIDDEN')
    asRole('OWNER')
    signatures.findById.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_SIGNATURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.signatureImage('u', 'ws', 'p1', 's1'),
      'CRM_PROPOSAL_SIGNATURE_NOT_FOUND',
    )
  })
})


describe('handleBoletoNotification', () => {
  const boleto = createFakeCrmProposalCharge({
    method: 'BOLETO',
    amount: new Prisma.Decimal(300),
  })
  const at = new Date()

  it('settles a paid boleto through the common payment path', async () => {
    charges.findByProviderCharge.mockResolvedValue(ok(boleto))
    charges.markPaid.mockResolvedValue(ok({ ...boleto, status: 'PAID' as const }))
    proposals.findById.mockResolvedValue(ok(sentProposal()))
    expectOk(
      await Service.handleBoletoNotification('mock', {
        kind: 'PAID',
        providerChargeId: boleto.providerChargeId,
        amount: null,
        at,
      }),
    )
    expect(charges.markPaid).toHaveBeenCalledWith(
      boleto.id,
      expect.objectContaining({ paidAmount: 300, paidAt: at }),
    )
  })

  it('only logs refunds and expiries', async () => {
    charges.findByProviderCharge.mockResolvedValue(ok(boleto))
    expectOk(
      await Service.handleBoletoNotification('mock', {
        kind: 'REFUNDED',
        providerChargeId: boleto.providerChargeId,
        amount: 300,
        at,
      }),
    )
    expect(charges.markPaid).not.toHaveBeenCalled()
  })

  it('treats a Pix charge or an unknown id as not found, and passes read errors', async () => {
    const notice = { kind: 'PAID' as const, providerChargeId: 'x', amount: 1, at }
    charges.findByProviderCharge.mockResolvedValue(ok(null))
    expectErr(
      await Service.handleBoletoNotification('mock', notice),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )
    charges.findByProviderCharge.mockResolvedValue(
      ok(createFakeCrmProposalCharge({ method: 'PIX' })),
    )
    expectErr(
      await Service.handleBoletoNotification('mock', notice),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )
    charges.findByProviderCharge.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.handleBoletoNotification('mock', notice),
      'DATABASE_ERROR',
    )
  })
})
