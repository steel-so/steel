import type {
  SdTicketWhatsappDTO,
  SdWhatsappConnectionDTO,
  SdWhatsappConversationDTO,
  SdWhatsappMessageDTO,
  SdWhatsappTemplateDTO,
} from '@/types/sd-whatsapp'

/** Fixtures da fatia whatsapp-ai (aba do chamado, copiloto, pré-atendimento). */

export const WS = 'ws-1'
export const SLUG = 'acme'
export const TICKET_ID = 't1'

export const AI_URL = `/api/workspaces/${WS}/servicedesk/ai`
export const WA_URL = `/api/workspaces/${WS}/servicedesk/whatsapp`
export const WA_TICKET_URL = `${WA_URL}/tickets/${TICKET_ID}`

/**
 * Resposta de erro com o `code` do envelope (`mockFetch` só monta
 * `message`), que é o que a UI usa para tratar SD_AI_DISABLED e afins.
 */
export function apiError(code: string, message: string, status = 403) {
  return () =>
    new Response(
      JSON.stringify({
        success: false,
        statusCode: status,
        message,
        error: { code },
      }),
      { status, headers: { 'content-type': 'application/json' } },
    )
}

export function waConnection(
  overrides: Partial<SdTicketWhatsappDTO['connection'] & object> = {},
): NonNullable<SdTicketWhatsappDTO['connection']> {
  return {
    id: 'conn-1',
    label: 'Suporte',
    provider: 'META',
    phoneNumber: '5511988887777',
    status: 'CONNECTED',
    ...overrides,
  }
}

export function waConversation(
  overrides: Partial<SdWhatsappConversationDTO> = {},
): SdWhatsappConversationDTO {
  return {
    id: 'conv-1',
    connectionId: 'conn-1',
    contact: {
      id: 'ct-1',
      name: 'Rui Solicitante',
      waId: '5511999998888',
      avatarUrl: null,
    },
    status: 'IN_PROGRESS',
    aiActive: false,
    aiHandoff: true,
    lastMessageAt: '2026-09-21T12:00:00.000Z',
    lastMessagePreview: 'Bom dia',
    openTicket: null,
    ...overrides,
  }
}

export function waState(
  overrides: Partial<SdTicketWhatsappDTO> = {},
): SdTicketWhatsappDTO {
  return {
    configured: true,
    connection: waConnection(),
    conversation: waConversation(),
    window: {
      open: true,
      expiresAt: '2026-09-22T12:00:00.000Z',
      requiresTemplate: false,
    },
    suggestedWaId: '5511999998888',
    ...overrides,
  }
}

export function waMessage(
  overrides: Partial<SdWhatsappMessageDTO> = {},
): SdWhatsappMessageDTO {
  return {
    id: 'm1',
    workspaceId: WS,
    conversationId: 'conv-1',
    direction: 'IN',
    type: 'TEXT',
    text: 'O sistema caiu',
    mediaUrl: null,
    status: 'DELIVERED',
    senderUserId: null,
    sentByAi: false,
    replyToMessageId: null,
    reactionEmoji: null,
    reactedByContact: null,
    contactPayload: null,
    buttons: null,
    buttonPayload: null,
    createdAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}

export function waTemplate(
  overrides: Partial<SdWhatsappTemplateDTO> = {},
): SdWhatsappTemplateDTO {
  return {
    id: 'tpl-1',
    name: 'retomada_atendimento',
    language: 'pt_BR',
    category: 'UTILITY',
    body: 'Olá {{1}}, podemos continuar o atendimento?',
    variableCount: 1,
    ...overrides,
  }
}

export function sdConnection(
  overrides: Partial<SdWhatsappConnectionDTO> = {},
): SdWhatsappConnectionDTO {
  return {
    id: 'conn-1',
    provider: 'ZAPI',
    label: 'Suporte',
    phoneNumber: '5511988887777',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: 'inst-1',
    metaPhoneNumberId: null,
    metaWabaId: null,
    active: true,
    webhookPath: '/api/whatsapp/webhook/zapi?secret=abc',
    createdAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}
