import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const registry = vi.hoisted(() => ({ getBoletoProviderById: vi.fn() }))
vi.mock('@/src/lib/boleto/registry', () => registry)
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../crm-proposal-payment.service', () => ({
  CrmProposalPaymentService: { handleBoletoNotification: vi.fn() },
}))
vi.mock('../whatsapp-boleto.service', () => ({
  WhatsAppBoletoService: { handleNotification: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { CrmProposalPaymentService } from '../crm-proposal-payment.service'
import { BoletoWebhookService } from '../boleto-webhook.service'
import { WhatsAppBoletoService } from '../whatsapp-boleto.service'

const proposal = vi.mocked(CrmProposalPaymentService.handleBoletoNotification)
const chat = vi.mocked(WhatsAppBoletoService.handleNotification)

const notice = {
  kind: 'PAID' as const,
  providerChargeId: 'b',
  amount: 1,
  at: new Date(),
}
const proposalMissing = err({
  code: 'CRM_PROPOSAL_CHARGE_NOT_FOUND',
  message: 'x',
} as never)
const chatMissing = err({ code: 'BOLETO_CHARGE_NOT_FOUND', message: 'x' } as never)

describe('BoletoWebhookService.handle()', () => {
  const headers = new Headers()
  const query = new URLSearchParams()

  beforeEach(() => {
    vi.clearAllMocks()
    registry.getBoletoProviderById.mockReturnValue(
      ok({ parseWebhook: vi.fn(() => ok([notice])) }),
    )
  })

  it('settles a proposal charge first', async () => {
    proposal.mockResolvedValue(ok({} as never))
    expect(
      expectOk(await BoletoWebhookService.handle('mock', headers, '{}', query)),
    ).toEqual({ received: 1, processed: 1 })
    expect(chat).not.toHaveBeenCalled()
  })

  it('falls back to the conversation charge', async () => {
    proposal.mockResolvedValue(proposalMissing)
    chat.mockResolvedValue(ok({} as never))
    expect(
      expectOk(await BoletoWebhookService.handle('mock', headers, '{}')).processed,
    ).toBe(1)
  })

  it('logs unknown charges and still acknowledges', async () => {
    proposal.mockResolvedValue(proposalMissing)
    chat.mockResolvedValue(chatMissing)
    expect(
      expectOk(await BoletoWebhookService.handle('mock', headers, '{}')),
    ).toEqual({ received: 1, processed: 0 })
    expect(logger.warn).toHaveBeenCalledWith(
      'boleto.webhook_unknown_charge',
      expect.anything(),
    )
  })

  it('stops at real failures of either side', async () => {
    proposal.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await BoletoWebhookService.handle('mock', headers, '{}'),
      'DATABASE_ERROR',
    )
    proposal.mockResolvedValue(proposalMissing)
    chat.mockResolvedValue(err(databaseError('y')))
    expectErr(
      await BoletoWebhookService.handle('mock', headers, '{}'),
      'DATABASE_ERROR',
    )
  })

  it('answers 404 for an unknown provider and passes auth errors on', async () => {
    registry.getBoletoProviderById.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await BoletoWebhookService.handle('x', headers, '{}'),
      'RESOURCE_NOT_FOUND',
    )
    registry.getBoletoProviderById.mockReturnValue(
      ok({ parseWebhook: () => err(forbidden()) }),
    )
    expectErr(await BoletoWebhookService.handle('mock', headers, '{}'), 'FORBIDDEN')
  })
})
