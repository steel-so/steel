import 'server-only'

export interface WhatsAppSendResult {
  providerMessageId: string
}

export interface WhatsAppOutboundText {
  to: string
  text: string
  quotedProviderMessageId?: string
  // Z-API group mentions — phone numbers to highlight as @mentions. Ignored
  // by providers/targets that don't support it (Meta has no group support at all).
  mentionedWaIds?: string[]
}

export type WhatsAppOutboundMediaType = 'image' | 'audio' | 'video' | 'document'

export interface WhatsAppOutboundMedia {
  to: string
  mediaUrl: string
  type: WhatsAppOutboundMediaType
  caption?: string
  fileName?: string
  quotedProviderMessageId?: string
}

export interface WhatsAppOutboundReaction {
  to: string
  providerMessageId: string
  // Empty string removes the reaction.
  emoji: string
}

export interface WhatsAppOutboundTemplate {
  to: string
  templateName: string
  language: string
  components?: unknown[]
  /**
   * Send through the Marketing Messages Lite API (Meta only; ignored by
   * Z-API). `cloudApiFallback` lets Meta use the regular Cloud API when the
   * Lite API can't deliver.
   */
  marketingLite?: { cloudApiFallback: boolean }
}

export interface WhatsAppOutboundContact {
  to: string
  name: string
  waId: string
}

/** A button as the provider sends it; `id` is the click payload of a reply
 * button (`stl:q:...`). */
export type WhatsAppOutboundButton =
  | { type: 'REPLY'; id: string; label: string }
  | { type: 'URL'; id: string; label: string; url: string }

/** Message with up to 2 buttons (quick replies). Meta: interactive message
 * (24h window); Z-API: button actions / button list. */
export interface WhatsAppOutboundButtons {
  to: string
  text: string
  buttons: WhatsAppOutboundButton[]
  media?: {
    url: string
    type: 'image' | 'video' | 'document'
    fileName?: string
  }
}

export interface WhatsAppQrCode {
  status: 'connected' | 'awaiting_scan'
  qrCodeBase64?: string
}

export interface WhatsAppProviderClient {
  sendText(input: WhatsAppOutboundText): Promise<WhatsAppSendResult>
  sendMedia(input: WhatsAppOutboundMedia): Promise<WhatsAppSendResult>
  sendTemplate(input: WhatsAppOutboundTemplate): Promise<WhatsAppSendResult>
  sendContact(input: WhatsAppOutboundContact): Promise<WhatsAppSendResult>
  sendButtons(input: WhatsAppOutboundButtons): Promise<WhatsAppSendResult>
  sendReaction(input: WhatsAppOutboundReaction): Promise<void>
  getConnectionStatus(): Promise<{
    connected: boolean
    failed?: boolean
    error?: string | null
  }>
}

export interface ZapiProviderClient extends WhatsAppProviderClient {
  getQrCode(): Promise<WhatsAppQrCode>
}

/**
 * Why an outbound message was sent, for the cost analysis (ADR 0050). Passed
 * as `options.cost` of `WhatsAppSend`; every field is optional context and a
 * send without it is recorded as `OTHER`.
 */
export interface WhatsAppCostContext {
  source?:
    | 'BROADCAST'
    | 'AI_CAMPAIGN'
    | 'CRM_CAMPAIGN'
    | 'AGENT'
    | 'AI_REPLY'
    | 'BUTTON'
    | 'OTHER'
  /** Meta category of the template (template sends only). */
  templateCategory?: string | null
  broadcastId?: string | null
  aiCampaignId?: string | null
  conversationId?: string | null
  userId?: string | null
}
