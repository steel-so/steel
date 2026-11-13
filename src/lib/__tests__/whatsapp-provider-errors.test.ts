import { describe, expect, it } from 'vitest'
import {
  WHATSAPP_WINDOW_CLOSED_MESSAGE,
  whatsappProviderMessage,
} from '@/src/lib/whatsapp/provider-errors'

function metaError(code: number, message = 'Graph error') {
  const error = new Error(message) as Error & { code: number }
  error.name = 'MetaApiError'
  error.code = code
  return error
}

describe('whatsappProviderMessage', () => {
  it('explains the closed 24h window (Meta 131047)', () => {
    expect(whatsappProviderMessage(metaError(131047))).toBe(
      WHATSAPP_WINDOW_CLOSED_MESSAGE,
    )
    expect(WHATSAPP_WINDOW_CLOSED_MESSAGE).toBe(
      'A janela de 24 horas expirou. Envie um modelo (template) aprovado.',
    )
  })

  it('maps template, number and rate limit codes', () => {
    expect(whatsappProviderMessage(metaError(132001))).toContain('modelo')
    expect(whatsappProviderMessage(metaError(131026))).toContain('número')
    expect(whatsappProviderMessage(metaError(130429))).toContain('Aguarde')
    expect(whatsappProviderMessage(metaError(190))).toContain('Reconecte')
  })

  it('does not trust a Meta code it does not know: falls to the message rules', () => {
    expect(whatsappProviderMessage(metaError(999999, 'Some English'))).toContain(
      'Não foi possível enviar',
    )
  })

  it('translates generic rate limit, invalid number and network failures', () => {
    expect(whatsappProviderMessage(new Error('Rate limit hit'))).toContain(
      'Muitos envios',
    )
    expect(whatsappProviderMessage(new Error('invalid phone'))).toContain(
      'não tem WhatsApp',
    )
    expect(whatsappProviderMessage(new Error('fetch failed'))).toContain(
      'Verifique a conexão',
    )
  })

  it('explains a disconnected Z-API instance', () => {
    expect(
      whatsappProviderMessage(
        new Error('A Z-API recusou a chamada (400): Instance not found'),
      ),
    ).toContain('QR Code')
  })

  it('keeps messages that are already pt-BR or from the Z-API', () => {
    expect(whatsappProviderMessage(new Error('Falha na requisição Meta API (500)'))).toBe(
      'Falha na requisição Meta API (500)',
    )
    expect(whatsappProviderMessage(new Error('Z-API said no'))).toBe(
      'Z-API said no',
    )
  })

  it('falls back to a generic message for English or empty errors', () => {
    expect(whatsappProviderMessage(new Error('Something broke'))).toContain(
      'Não foi possível enviar',
    )
    expect(whatsappProviderMessage('boom')).toContain('Não foi possível enviar')
    expect(whatsappProviderMessage(null)).toContain('Não foi possível enviar')
    expect(whatsappProviderMessage(new Error(''))).toContain(
      'Não foi possível enviar',
    )
  })
})
