import type { WhatsAppProvider } from '@prisma/client'
import { SERVICE_WINDOW_MS } from './service-window'

/**
 * Rules (no I/O) shared by the automation engines (CRM workflow, ServiceDesk
 * automation, chatbot) when they send a WhatsApp message on their own.
 *
 * - The LGPD opt-out always wins, and an opt-out we could not read blocks too.
 * - Meta: an APPROVED template goes through at any time; free text only inside
 *   the 24 h customer-service window.
 * - Z-API (unofficial): no templates and no window, free text only.
 */

export type CrossEngineOptOut = 'allowed' | 'opted_out' | 'unverified'

export type CrossEngineSkipReason =
  | 'opted_out'
  | 'opt_out_unverified'
  | 'no_message'
  | 'template_unavailable'
  | 'window_closed'

export type CrossEngineSendDecision =
  | { action: 'template' }
  | { action: 'text' }
  | { action: 'skip'; reason: CrossEngineSkipReason }

export interface CrossEngineDecisionInput {
  provider: WhatsAppProvider
  optOut: CrossEngineOptOut
  /** A template was picked in the node/action. */
  hasTemplate: boolean
  /** That template exists and is APPROVED on the connection. */
  templateApproved: boolean
  /** Free text was filled in (Z-API, or Meta inside the window). */
  hasText: boolean
  lastInboundAt: Date | null
  now?: Date
}

export const CROSS_ENGINE_SKIP_MESSAGE: Record<CrossEngineSkipReason, string> =
  {
    opted_out:
      'O contato pediu para não receber mensagens por WhatsApp (LGPD). A mensagem não foi enviada.',
    opt_out_unverified:
      'Não foi possível confirmar se o contato aceita mensagens por WhatsApp. A mensagem não foi enviada.',
    no_message:
      'Nenhuma mensagem configurada para esta conexão. Escolha um template (Meta) ou escreva o texto (Z-API).',
    template_unavailable:
      'O template escolhido não está aprovado nesta conexão e a janela de 24 horas está fechada.',
    window_closed:
      'A janela de 24 horas expirou. Escolha um template aprovado para falar com este contato.',
  }

export function crossEngineWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false
  return lastInboundAt.getTime() + SERVICE_WINDOW_MS > now.getTime()
}

export function decideCrossEngineSend(
  input: CrossEngineDecisionInput,
): CrossEngineSendDecision {
  if (input.optOut === 'opted_out') {
    return { action: 'skip', reason: 'opted_out' }
  }
  if (input.optOut === 'unverified') {
    return { action: 'skip', reason: 'opt_out_unverified' }
  }
  if (input.provider === 'ZAPI') {
    return input.hasText
      ? { action: 'text' }
      : { action: 'skip', reason: 'no_message' }
  }
  if (input.hasTemplate && input.templateApproved) {
    return { action: 'template' }
  }
  if (!input.hasTemplate && !input.hasText) {
    return { action: 'skip', reason: 'no_message' }
  }
  if (input.hasText && crossEngineWindowOpen(input.lastInboundAt, input.now)) {
    return { action: 'text' }
  }
  return {
    action: 'skip',
    reason: input.hasTemplate ? 'template_unavailable' : 'window_closed',
  }
}

/** Max length of one body parameter (Meta rejects very long values). */
const PARAM_MAX = 1000

/** Meta forbids newlines, tabs and runs of spaces inside a body parameter. */
export function sanitizeCrossEngineParam(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const value =
    clean.length > PARAM_MAX ? `${clean.slice(0, PARAM_MAX - 1)}…` : clean
  return value || '-'
}

/** Meta `components`: a single `body` with the ordered parameters. */
export function buildCrossEngineBodyComponents(values: string[]): unknown[] {
  if (values.length === 0) return []
  return [
    {
      type: 'body',
      parameters: values.map((text) => ({
        type: 'text',
        text: sanitizeCrossEngineParam(text),
      })),
    },
  ]
}
