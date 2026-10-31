import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const registry = vi.hoisted(() => ({ getBoletoProviderById: vi.fn() }))
vi.mock('@/src/lib/boleto/registry', () => registry)
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { BoletoWebhookService } from '../boleto-webhook.service'

describe('BoletoWebhookService.handle()', () => {
  const headers = new Headers()
  beforeEach(() => registry.getBoletoProviderById.mockReset())

  it('acknowledges the authenticated changes', async () => {
    const parseWebhook = vi.fn(() =>
      ok([{ kind: 'PAID', providerChargeId: 'b', amount: 1, at: new Date() }]),
    )
    registry.getBoletoProviderById.mockReturnValue(ok({ parseWebhook }))
    const query = new URLSearchParams()
    expect(expectOk(await BoletoWebhookService.handle('mock', headers, '{}', query))).toEqual({ received: 1 })
    expect(parseWebhook).toHaveBeenCalledWith(headers, '{}', query)
  })

  it('answers 404 for an unknown provider and passes auth errors on', async () => {
    registry.getBoletoProviderById.mockReturnValueOnce(err(forbidden()))
    expectErr(await BoletoWebhookService.handle('x', headers, '{}'), 'RESOURCE_NOT_FOUND')
    registry.getBoletoProviderById.mockReturnValue(
      ok({ parseWebhook: () => err(forbidden()) }),
    )
    expectErr(await BoletoWebhookService.handle('mock', headers, '{}'), 'FORBIDDEN')
  })
})
