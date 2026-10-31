import { PIX_PROVIDER, PIX_WEBHOOK_SECRET } from '@/lib/env/server'
import { pixProviderError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  ABACATEPAY_PIX_PROVIDER_ID,
  createAbacatePayPixProvider,
} from './abacatepay-provider'
import { createMockPixProvider, MOCK_PIX_PROVIDER_ID } from './mock-provider'
import type { PixProvider } from './provider'

/** Ids a webhook URL (`/api/whatsapp/pix/webhook/{provider}`) may name. */
export function getPixProviderById(id: string): Result<PixProvider> {
  if (id === MOCK_PIX_PROVIDER_ID) {
    return ok(createMockPixProvider(PIX_WEBHOOK_SECRET))
  }
  if (id === ABACATEPAY_PIX_PROVIDER_ID) {
    return ok(createAbacatePayPixProvider(PIX_WEBHOOK_SECRET))
  }
  return err(pixProviderError('Provedor de Pix desconhecido'))
}

/**
 * The provider new charges go through. `PIX_PROVIDER` falls back to `mock`
 * because env validation (and its zod defaults) is bypassed under
 * `SKIP_ENV_VALIDATION` / `NODE_ENV=test`.
 */
export function getActivePixProvider(): Result<PixProvider> {
  return getPixProviderById(PIX_PROVIDER ?? MOCK_PIX_PROVIDER_ID)
}
