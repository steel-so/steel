import { describe, expect, it } from 'vitest'
import type { ExportableWhatsAppMessage } from '@/src/lib/whatsapp/conversation-export'
import {
  buildWhatsAppConversationPdf,
  conversationPdfMessageText,
} from '@/src/lib/whatsapp/conversation-export-pdf'

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
    createdAt: new Date('2026-10-20T17:05:00.000Z'),
    ...overrides,
  }
}

describe('conversationPdfMessageText', () => {
  it('is the text of a text message', () => {
    expect(conversationPdfMessageText(message({ text: '  Oi  ' }))).toBe('Oi')
  })

  it('shows only a marker for media, never its URL', () => {
    expect(
      conversationPdfMessageText(
        message({
          type: 'IMAGE',
          mediaUrl: 'https://cdn.example/foto.jpg',
          text: null,
        }),
      ),
    ).toBe('[imagem]')
  })

  it('keeps the caption after the media marker', () => {
    expect(
      conversationPdfMessageText(
        message({ type: 'DOCUMENT', mediaUrl: 'ws/x.pdf', text: 'Boleto' }),
      ),
    ).toBe('[documento] Boleto')
  })

  it('never returns an empty cell', () => {
    expect(conversationPdfMessageText(message({ text: null }))).toBe('—')
  })

  it('replaces emoji so the built-in font does not print garbage', () => {
    expect(conversationPdfMessageText(message({ text: 'ok 👍' }))).toBe(
      'ok [emoji]',
    )
  })
})

describe('buildWhatsAppConversationPdf', () => {
  const input = {
    contactName: 'Maria José 😀',
    contactWaId: '5511988887777',
    messages: [
      message(),
      message({ direction: 'OUT', senderName: 'Ana', text: 'Bom dia' }),
      message({ direction: 'OUT', sentByAi: true, text: 'Posso ajudar?' }),
      message({ type: 'AUDIO', text: null }),
    ],
  }

  it('renders a PDF file named after the contact', async () => {
    const file = await buildWhatsAppConversationPdf(
      input,
      new Date('2026-10-26T05:00:00.000Z'),
    )
    expect(file.fileName).toBe('conversa-maria-jose.pdf')
    expect(file.contentType).toBe('application/pdf')
    const bytes = file.body as Uint8Array
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(500)
  })

  it('renders a conversation without messages', async () => {
    const file = await buildWhatsAppConversationPdf({
      ...input,
      messages: [],
    })
    expect(
      Buffer.from(file.body as Uint8Array)
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-')
  })
})
