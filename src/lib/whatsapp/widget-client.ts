import { randomUUID } from 'node:crypto'
import type { WhatsAppProviderClient, WhatsAppSendResult } from './types'

/**
 * Provider client of the site chat widget (E1). There is no network hop: an
 * outbound message is already stored on the conversation by the caller, and
 * the visitor's browser picks it up by polling. So a "send" only mints the
 * provider message id.
 */
export function createWidgetClient(): WhatsAppProviderClient {
  const accept = async (): Promise<WhatsAppSendResult> => ({
    providerMessageId: `widget:out:${randomUUID()}`,
  })
  return {
    sendText: accept,
    sendMedia: accept,
    sendTemplate: accept,
    sendContact: accept,
    sendButtons: accept,
    async sendReaction() {},
    async getConnectionStatus() {
      return { connected: true }
    },
  }
}
