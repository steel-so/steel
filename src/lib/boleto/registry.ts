import { BOLETO_PROVIDER, BOLETO_WEBHOOK_SECRET } from '@/lib/env/server'
import { boletoProviderError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  ABACATEPAY_BOLETO_PROVIDER_ID,
  createAbacatePayBoletoProvider,
} from './abacatepay-provider'
import { createMockBoletoProvider, MOCK_BOLETO_PROVIDER_ID } from './mock-provider'
import type { BoletoProvider } from './provider'

/** Ids a webhook URL (`/api/boleto/webhook/{provider}`) may name. */
export function getBoletoProviderById(id: string): Result<BoletoProvider> {
  if (id === MOCK_BOLETO_PROVIDER_ID) {
    return ok(createMockBoletoProvider(BOLETO_WEBHOOK_SECRET))
  }
  if (id === ABACATEPAY_BOLETO_PROVIDER_ID) {
    return ok(createAbacatePayBoletoProvider(BOLETO_WEBHOOK_SECRET))
  }
  return err(boletoProviderError('Provedor de boleto desconhecido'))
}

/** The provider new boletos go through (`mock` unless `BOLETO_PROVIDER` says so). */
export function getActiveBoletoProvider(): Result<BoletoProvider> {
  return getBoletoProviderById(BOLETO_PROVIDER ?? MOCK_BOLETO_PROVIDER_ID)
}
