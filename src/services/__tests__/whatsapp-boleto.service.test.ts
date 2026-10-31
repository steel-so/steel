import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeWhatsAppBoletoCharge } from '@/src/__tests__/factories/nov-pix-abacatepay.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  loadVisibleConversation: vi.fn(),
}))
vi.mock('../whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: { assertOpen: vi.fn() },
}))
vi.mock('../whatsapp-pix.service', () => ({
  authorizeConversation: vi.fn(),
  checkOpportunity: vi.fn(),
  deliverText: vi.fn(),
  formatPixAmount: (n: number) => `R$ ${n}`,
}))
vi.mock('@/src/lib/boleto/registry', () => ({
  getActiveBoletoProvider: vi.fn(),
}))
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-boleto.repository')

import { logger } from '@/lib/axiom/logger'
import { getActiveBoletoProvider } from '@/src/lib/boleto/registry'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  WhatsAppBoletoChargeRepository,
  WhatsAppBoletoSettingsRepository,
} from '@/src/repositories/whatsapp-boleto.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'
import { loadVisibleConversation } from '../whatsapp-conversation-scope.service'
import {
  authorizeConversation,
  checkOpportunity,
  deliverText,
} from '../whatsapp-pix.service'
import {
  boletoMessageText,
  WhatsAppBoletoService as Service,
} from '../whatsapp-boleto.service'

const settingsRepo = vi.mocked(WhatsAppBoletoSettingsRepository)
const chargeRepo = vi.mocked(WhatsAppBoletoChargeRepository)
const activeProvider = vi.mocked(getActiveBoletoProvider)
const scope = vi.mocked(authorizeConversation)
const visible = vi.mocked(loadVisibleConversation)
const deliver = vi.mocked(deliverText)
const opportunities = vi.mocked(CrmOpportunityRepository)
const notes = vi.mocked(CrmNoteRepository)

const WS = 'ws1'
const provider = {
  id: 'mock',
  isTest: true,
  createCharge: vi.fn(),
  getChargeStatus: vi.fn(),
  parseWebhook: vi.fn(),
}
const dto = {
  amount: 250,
  description: 'Mensalidade',
  payerName: 'Maria',
  payerTaxId: '11144477735',
  dueInDays: 3,
}

beforeEach(() => {
  vi.resetAllMocks()
  activeProvider.mockReturnValue(ok(provider as never))
  provider.createCharge.mockResolvedValue(
    ok({
      providerChargeId: 'bol1',
      barCode: '123',
      url: 'https://u',
      brCode: null,
      dueAt: new Date('2026-12-10T12:00:00Z'),
    }),
  )
})

describe('boletoMessageText', () => {
  it('lists the amount, due date and digitable line, with the link when there is one', () => {
    const base = {
      amount: 10,
      description: 'Taxa',
      dueAt: new Date('2026-12-10T15:00:00Z'),
      barCode: '111',
    }
    const withLink = boletoMessageText({ ...base, url: 'https://u' })
    expect(withLink).toContain('Vencimento: 10/12/2026')
    expect(withLink).toContain('111')
    expect(withLink).toContain('https://u')
    expect(boletoMessageText({ ...base, url: null })).not.toContain('https')
  })
})

describe('settings', () => {
  it('reads them for any module member, defaulting to off', async () => {
    vi.mocked(assertModuleMember).mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(expectOk(await Service.getSettings('u', WS))).toMatchObject({
      enabled: false,
      provider: 'mock',
      isTestProvider: true,
    })
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok({ enabled: true } as never),
    )
    expect(expectOk(await Service.getSettings('u', WS)).enabled).toBe(true)
  })

  it('fails on denial, read errors and provider errors', async () => {
    vi.mocked(assertModuleMember).mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.getSettings('u', WS), 'FORBIDDEN')
    vi.mocked(assertModuleMember).mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.getSettings('u', WS), 'DATABASE_ERROR')
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    activeProvider.mockReturnValueOnce(err(forbidden()))
    expectErr(await Service.getSettings('u', WS), 'FORBIDDEN')
  })

  it('lets only privileged members switch it', async () => {
    vi.mocked(assertModulePrivileged).mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.updateSettings('u', WS, { enabled: true }), 'FORBIDDEN')

    vi.mocked(assertModulePrivileged).mockResolvedValue(ok({} as never))
    settingsRepo.upsert.mockResolvedValue(
      ok({ id: 's1', enabled: true } as never),
    )
    expect(
      expectOk(await Service.updateSettings('u', WS, { enabled: true })).enabled,
    ).toBe(true)
    expect(settingsRepo.upsert).toHaveBeenCalledWith(WS, { enabled: true })
    await Service.updateSettings('u', WS, {})
    expect(settingsRepo.upsert).toHaveBeenLastCalledWith(WS, {})

    activeProvider.mockReturnValueOnce(err(forbidden()))
    expectErr(await Service.updateSettings('u', WS, {}), 'FORBIDDEN')
    settingsRepo.upsert.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.updateSettings('u', WS, {}), 'DATABASE_ERROR')
  })
})

describe('createCharge', () => {
  const conversation = createFakeWhatsAppConversationWithPreview({
    aiActive: false,
  })
  const connection = createFakeWhatsAppConnection()

  beforeEach(() => {
    scope.mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(ok({ enabled: true } as never))
    visible.mockResolvedValue(ok(conversation))
    vi.mocked(WhatsAppBusinessHoursService.assertOpen).mockResolvedValue(
      ok(undefined),
    )
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
    vi.mocked(checkOpportunity).mockResolvedValue(ok(undefined))
    chargeRepo.create.mockImplementation(async (data) =>
      ok(createFakeWhatsAppBoletoCharge({ ...data } as never)),
    )
    deliver.mockResolvedValue(ok({} as never))
  })

  it('issues the boleto, stores it and sends the message', async () => {
    const result = expectOk(await Service.createCharge('u', WS, 'c1', dto))
    expect(result.provider).toBe('mock')
    expect(provider.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 250,
        payer: { name: 'Maria', taxId: '11144477735' },
        dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    expect(chargeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerChargeId: 'bol1',
        barCode: '123',
        payerTaxId: '11144477735',
      }),
    )
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('falls back to the computed due date when the PSP sends none', async () => {
    provider.createCharge.mockResolvedValue(
      ok({ providerChargeId: 'b', barCode: '1', url: null, brCode: null, dueAt: null }),
    )
    expectOk(await Service.createCharge('u', WS, 'c1', dto))
    expect(chargeRepo.create.mock.calls[0]?.[0].dueAt).toBeInstanceOf(Date)
  })

  it('is off by default and for denied members', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'BOLETO_DISABLED')
    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'DATABASE_ERROR')
    scope.mockResolvedValue(err(forbidden()))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
    expect(provider.createCharge).not.toHaveBeenCalled()
  })

  it('refuses while the AI handles the conversation, outside hours or without a connection', async () => {
    visible.mockResolvedValueOnce(
      ok({ ...conversation, aiActive: true } as never),
    )
    expectErr(
      await Service.createCharge('u', WS, 'c1', dto),
      'WHATSAPP_CONVERSATION_AI_HANDLING',
    )
    visible.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
    vi.mocked(WhatsAppBusinessHoursService.assertOpen).mockResolvedValueOnce(
      err(forbidden()),
    )
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValueOnce(
      ok(null),
    )
    expectErr(
      await Service.createCharge('u', WS, 'c1', dto),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'DATABASE_ERROR')
    vi.mocked(checkOpportunity).mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
  })

  it('passes on PSP and storage failures, and closes the charge when sending fails', async () => {
    provider.createCharge.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
    chargeRepo.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'DATABASE_ERROR')
    chargeRepo.markCanceled.mockResolvedValue(ok(null))
    deliver.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.createCharge('u', WS, 'c1', dto), 'FORBIDDEN')
    expect(chargeRepo.markCanceled).toHaveBeenCalled()
  })
})

describe('listByConversation', () => {
  it('lists the charges of a visible conversation', async () => {
    scope.mockResolvedValue(ok({} as never))
    visible.mockResolvedValue(ok({} as never))
    chargeRepo.listByConversation.mockResolvedValue(
      ok([createFakeWhatsAppBoletoCharge()]),
    )
    expect(expectOk(await Service.listByConversation('u', WS, 'c1'))).toHaveLength(1)
    chargeRepo.listByConversation.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.listByConversation('u', WS, 'c1'), 'DATABASE_ERROR')
    visible.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.listByConversation('u', WS, 'c1'), 'FORBIDDEN')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.listByConversation('u', WS, 'c1'), 'FORBIDDEN')
  })
})

describe('cancel', () => {
  const charge = createFakeWhatsAppBoletoCharge({ conversationId: 'c1' })

  beforeEach(() => {
    scope.mockResolvedValue(ok({} as never))
    visible.mockResolvedValue(ok({} as never))
    chargeRepo.findById.mockResolvedValue(ok(charge))
    chargeRepo.markCanceled.mockResolvedValue(
      ok({ ...charge, status: 'CANCELED' as const }),
    )
  })

  it('closes a pending charge', async () => {
    expect(expectOk(await Service.cancel('u', WS, 'c1', charge.id)).status).toBe(
      'CANCELED',
    )
  })

  it('rejects other conversations, settled charges and races', async () => {
    chargeRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(await Service.cancel('u', WS, 'c1', 'x'), 'BOLETO_CHARGE_NOT_FOUND')
    expectErr(await Service.cancel('u', WS, 'other', charge.id), 'BOLETO_CHARGE_NOT_FOUND')
    chargeRepo.findById.mockResolvedValueOnce(
      ok({ ...charge, status: 'PAID' as const }),
    )
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'BOLETO_CHARGE_NOT_PENDING')
    chargeRepo.markCanceled.mockResolvedValueOnce(ok(null))
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'BOLETO_CHARGE_NOT_PENDING')
    chargeRepo.markCanceled.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'DATABASE_ERROR')
    chargeRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'DATABASE_ERROR')
    visible.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'FORBIDDEN')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.cancel('u', WS, 'c1', charge.id), 'FORBIDDEN')
  })
})

describe('handleNotification', () => {
  const charge = createFakeWhatsAppBoletoCharge({ opportunityId: 'o1' })
  const at = new Date()
  const notice = (kind: 'PAID' | 'REFUNDED' | 'EXPIRED', amount: number | null = 250) => ({
    kind,
    providerChargeId: charge.providerChargeId,
    amount,
    at,
  })

  beforeEach(() => {
    chargeRepo.findByProviderCharge.mockResolvedValue(ok(charge))
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ id: 'o1' })),
    )
    notes.create.mockResolvedValue(ok({} as never))
  })

  it('settles a paid boleto and notes the deal', async () => {
    chargeRepo.markPaid.mockResolvedValue(
      ok({ ...charge, status: 'PAID' as const, paidAmount: 250 as never }),
    )
    expect(expectOk(await Service.handleNotification('mock', notice('PAID'))).status).toBe(
      'PAID',
    )
    expect(chargeRepo.markPaid).toHaveBeenCalledWith(charge.id, {
      paidAt: at,
      paidAmount: 250,
    })
    expect(notes.create).toHaveBeenCalled()
  })

  it('uses the charged amount when the PSP sends none, and tolerates a failed note', async () => {
    chargeRepo.markPaid.mockResolvedValue(
      ok({ ...charge, status: 'PAID' as const }),
    )
    notes.create.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.handleNotification('mock', notice('PAID', null)))
    expect(chargeRepo.markPaid.mock.calls[0]?.[1].paidAmount).toBe(250)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.boleto.note_failed',
      expect.anything(),
    )
  })

  it('does not note a deal-less charge or a vanished deal', async () => {
    const plain = { ...charge, opportunityId: null, status: 'PAID' as const }
    chargeRepo.findByProviderCharge.mockResolvedValue(ok(plain))
    chargeRepo.markPaid.mockResolvedValue(ok(plain))
    expectOk(await Service.handleNotification('mock', notice('PAID')))
    chargeRepo.markPaid.mockResolvedValue(ok({ ...plain, opportunityId: 'o1' }))
    opportunities.findById.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.handleNotification('mock', notice('PAID')))
    expect(notes.create).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-paid charge', async () => {
    chargeRepo.markPaid.mockResolvedValue(ok(null))
    expectOk(await Service.handleNotification('mock', notice('PAID')))
    expect(notes.create).not.toHaveBeenCalled()
  })

  it('applies refunds and expiries', async () => {
    chargeRepo.markRefunded.mockResolvedValue(
      ok({ ...charge, status: 'REFUNDED' as const }),
    )
    chargeRepo.markExpired.mockResolvedValue(ok(null))
    expect(
      expectOk(await Service.handleNotification('mock', notice('REFUNDED'))).status,
    ).toBe('REFUNDED')
    expectOk(await Service.handleNotification('mock', notice('EXPIRED')))
    expect(chargeRepo.markExpired).toHaveBeenCalled()
  })

  it('reports unknown charges and propagates database errors', async () => {
    chargeRepo.findByProviderCharge.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.handleNotification('mock', notice('PAID')),
      'BOLETO_CHARGE_NOT_FOUND',
    )
    chargeRepo.findByProviderCharge.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.handleNotification('mock', notice('PAID')), 'DATABASE_ERROR')
    chargeRepo.markPaid.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.handleNotification('mock', notice('PAID')), 'DATABASE_ERROR')
    chargeRepo.markRefunded.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.handleNotification('mock', notice('REFUNDED')),
      'DATABASE_ERROR',
    )
  })
})
