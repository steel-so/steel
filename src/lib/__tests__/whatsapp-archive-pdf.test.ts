import { describe, expect, it } from 'vitest'
import {
  type AtendimentoPdfInput,
  type AtendimentoPdfMessage,
  atendimentoMessageText,
  renderAtendimentoPdf,
} from '@/src/lib/whatsapp/archive/pdf'

/**
 * PDF of one atendimento (ADR 0052): rendered for real (same path as the
 * worker) and the text of each message row.
 */

function message(
  overrides: Partial<AtendimentoPdfMessage> = {},
): AtendimentoPdfMessage {
  return {
    id: 'm1',
    direction: 'IN',
    type: 'TEXT',
    text: 'Olá',
    mediaUrl: null,
    sentByAi: false,
    senderName: null,
    createdAt: new Date('2026-10-20T17:05:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function input(
  overrides: Partial<AtendimentoPdfInput> = {},
): AtendimentoPdfInput {
  return {
    workspaceName: 'Fidelizza+',
    connectionLabel: 'Cobrança',
    connectionPhone: '551130000000',
    contactName: 'Maria José 😀',
    contactWaId: '5511988887777',
    attendants: ['Ana Souza'],
    dayKey: '2026-10-20',
    protocol: null,
    conversationId: 'c1',
    messages: [
      message(),
      message({
        id: 'm2',
        direction: 'OUT',
        senderName: 'Ana Souza',
        text: 'Segue o boleto 👍',
        type: 'DOCUMENT',
        mediaUrl: 'ws/boleto.pdf',
      }),
      message({
        id: 'm3',
        direction: 'OUT',
        sentByAi: true,
        text: 'Posso ajudar?',
      }),
      message({ id: 'm4', deletedAt: new Date(), text: 'apagada' }),
    ],
    generatedAt: new Date('2026-10-26T05:00:00.000Z'),
    ...overrides,
  }
}

describe('atendimentoMessageText', () => {
  it('is the text of a text message', () => {
    expect(atendimentoMessageText(message({ text: '  Oi  ' }))).toBe('Oi')
  })

  it('shows the media placeholder and the file name before the caption', () => {
    expect(
      atendimentoMessageText(
        message({ type: 'IMAGE', mediaUrl: 'ws/foto.jpg', text: 'legenda' }),
      ),
    ).toBe('[imagem] foto.jpg legenda')
  })

  it('shows only the placeholder when the media has no file name', () => {
    expect(
      atendimentoMessageText(
        message({ type: 'AUDIO', mediaUrl: 'https://cdn/123', text: null }),
      ),
    ).toBe('[áudio]')
  })

  it('marks deleted messages', () => {
    expect(
      atendimentoMessageText(message({ deletedAt: new Date(), text: 'x' })),
    ).toBe('[mensagem apagada] x')
  })

  it('is a dash when there is nothing to show', () => {
    expect(atendimentoMessageText(message({ text: null }))).toBe('—')
  })

  it('makes emoji printable', () => {
    expect(atendimentoMessageText(message({ text: 'ok 👍' }))).toBe(
      'ok [emoji]',
    )
  })
})

describe('renderAtendimentoPdf', () => {
  it('renders a PDF with the header, rows and footer', async () => {
    const pdf = await renderAtendimentoPdf(input())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
    expect(pdf.toString('latin1')).toContain('/Count 1')
  })

  it('renders the protocol, several attendants and a BSUID contact', async () => {
    const pdf = await renderAtendimentoPdf(
      input({
        protocol: '2026-000123',
        attendants: ['Ana', 'IA'],
        contactName: null,
        contactWaId: 'BR.123',
      }),
    )
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('breaks a long atendimento into several pages', async () => {
    const messages = Array.from({ length: 120 }, (_, i) =>
      message({ id: `m${i}`, text: `mensagem ${i} `.repeat(8) }),
    )
    const pdf = await renderAtendimentoPdf(input({ messages }))
    const pages = Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1])
    expect(pages).toBeGreaterThan(1)
  })
})
