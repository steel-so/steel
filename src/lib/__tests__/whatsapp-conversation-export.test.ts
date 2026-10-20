import { describe, expect, it } from 'vitest'
import {
  buildWhatsAppConversationExport,
  type ExportableWhatsAppMessage,
} from '@/src/lib/whatsapp/conversation-export'

function message(
  overrides: Partial<ExportableWhatsAppMessage> = {},
): ExportableWhatsAppMessage {
  return {
    direction: 'IN',
    type: 'TEXT',
    text: 'Olá',
    mediaUrl: null,
    sentByAi: false,
    senderName: null,
    // 12:00 UTC = 09:00 in São Paulo
    createdAt: new Date('2026-10-20T12:00:00Z'),
    ...overrides,
  }
}

const input = {
  contactName: 'João Silva',
  contactWaId: '5511999990000',
  messages: [
    message(),
    message({ direction: 'OUT', text: 'Oi, João', senderName: 'Ana' }),
    message({ direction: 'OUT', text: 'Posso ajudar?', sentByAi: true }),
    message({
      type: 'IMAGE',
      text: 'segue a foto',
      mediaUrl: 'https://cdn/x.jpg',
    }),
  ],
}

describe('buildWhatsAppConversationExport()', () => {
  it('should build a WhatsApp-like text transcript in São Paulo time', () => {
    const file = buildWhatsAppConversationExport(input, 'txt')

    expect(file.fileName).toBe('conversa-joao-silva.txt')
    expect(file.contentType).toContain('text/plain')
    const lines = file.body.split('\n')
    expect(lines[0]).toBe('Conversa com João Silva (+5511999990000)')
    expect(lines).toContain('[20/10/2026 09:00] João Silva: Olá')
    expect(lines).toContain('[20/10/2026 09:00] Ana: Oi, João')
    expect(lines).toContain('[20/10/2026 09:00] IA: Posso ajudar?')
    expect(lines).toContain(
      '[20/10/2026 09:00] João Silva: [imagem] segue a foto https://cdn/x.jpg',
    )
  })

  it('should build a CSV with one row per message', () => {
    const file = buildWhatsAppConversationExport(input, 'csv')

    expect(file.fileName).toBe('conversa-joao-silva.csv')
    expect(file.contentType).toContain('text/csv')
    const rows = file.body.replace(/^﻿/, '').split('\r\n')
    expect(rows[0]).toBe('Data/hora,Direção,Remetente,Tipo,Mensagem')
    expect(rows).toHaveLength(5)
    expect(rows[2]).toBe('20/10/2026 09:00,Enviada,Ana,TEXT,"Oi, João"')
  })

  it('should fall back to the phone number and "Atendente" when names are missing', () => {
    const file = buildWhatsAppConversationExport(
      {
        contactName: null,
        contactWaId: '5511888880000',
        messages: [message({ direction: 'OUT', text: 'Oi' })],
      },
      'txt',
    )

    expect(file.fileName).toBe('conversa-5511888880000.txt')
    expect(file.body).toContain('Atendente: Oi')
  })
})
