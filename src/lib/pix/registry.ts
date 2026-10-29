import { PIX_PROVIDER, PIX_WEBHOOK_SECRET } from '@/lib/env/server'
import { pixProviderError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { createMockPixProvider, MOCK_PIX_PROVIDER_ID } from './mock-provider'
import type { PixProvider } from './provider'

/** Ids a webhook URL (`/api/whatsapp/pix/webhook/{provider}`) may name. */
export function getPixProviderById(id: string): Result<PixProvider> {
  if (id === MOCK_PIX_PROVIDER_ID) {
    return ok(createMockPixProvider(PIX_WEBHOOK_SECRET))
  }
  return err(pixProviderError('Provedor de Pix desconhecido'))
}

/** The provider the workspace's new charges go through. */
export function getActivePixProvider(): Result<PixProvider> {
  return getPixProviderById(PIX_PROVIDER)
}
