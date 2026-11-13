import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDocumentRecipient } from '@/src/__tests__/factories/document-backend.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/lib/mail/documents/send-document-emails', () => ({
  sendDocumentSharedEmail: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('../whatsapp-opt-out', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-opt-out')>()),
  checkWhatsAppOptOut: vi.fn(),
}))
vi.mock('@/src/repositories/document-lookup.repository')
vi.mock('@/src/repositories/document-recipient.repository')

import { logger } from '@/lib/axiom/logger'
import { sendDocumentSharedEmail } from '@/src/lib/mail/documents/send-document-emails'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { DocumentLookupRepository } from '@/src/repositories/document-lookup.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { deliverDocument } from '../document-delivery'
import { checkWhatsAppOptOut } from '../whatsapp-opt-out'

const sendEmail = vi.mocked(sendDocumentSharedEmail)
const whatsapp = vi.mocked(WhatsAppSend)
const optOut = vi.mocked(checkWhatsAppOptOut)
const lookup = vi.mocked(DocumentLookupRepository)
const recipientRepo = vi.mocked(DocumentRecipientRepository)

const AT = new Date('2026-11-11T12:00:00.000Z')
const CTX = {
  workspaceId: 'ws1',
  documentId: 'd1',
  documentTitle: 'Proposta 2027',
  workspaceName: 'Stratus Lab',
  senderName: 'João Lima',
  senderEmail: 'joao@example.com',
  validUntil: new Date('2026-11-30T15:00:00.000Z'),
  message: 'Qualquer dúvida, me chame.',
}
const CONNECTION = { id: 'conn1', provider: 'ZAPI' } as never

const zapRecipient = (phone: string | null = '11988887777') =>
  createFakeDocumentRecipient({ channel: 'WHATSAPP', phone })
const mailRecipient = (email: string | null) =>
  createFakeDocumentRecipient({ channel: 'EMAIL', email })

beforeEach(() => {
  optOut.mockResolvedValue('allowed')
  recipientRepo.markSent.mockImplementation(async (id, data) =>
    ok(createFakeDocumentRecipient({ id, ...data, sentAt: data.at })),
  )
  sendEmail.mockResolvedValue({ id: 'mail' } as never)
  lookup.findConnectedWhatsApp.mockResolvedValue(ok(CONNECTION))
  whatsapp.text.mockResolvedValue(ok({ providerMessageId: 'wamid' }) as never)
})

describe('deliverDocument()', () => {
  it('delivers by link, e-mail and WhatsApp and marks each one sent', async () => {
    const link = createFakeDocumentRecipient({ id: 'r1', channel: 'LINK' })
    const mail = createFakeDocumentRecipient({
      id: 'r2',
      channel: 'EMAIL',
      email: 'maria@example.com',
      token: 'tok-mail',
    })
    const zap = createFakeDocumentRecipient({
      id: 'r3',
      channel: 'WHATSAPP',
      phone: '(11) 98888-7777',
      token: 'tok-zap',
    })

    const outcomes = await deliverDocument(CTX, [link, mail, zap], AT)

    expect(outcomes.map((outcome) => outcome.delivery)).toEqual([
      {
        recipientId: 'r1',
        requested: 'LINK',
        channel: 'LINK',
        delivered: true,
        message: null,
      },
      {
        recipientId: 'r2',
        requested: 'EMAIL',
        channel: 'EMAIL',
        delivered: true,
        message: null,
      },
      {
        recipientId: 'r3',
        requested: 'WHATSAPP',
        channel: 'WHATSAPP',
        delivered: true,
        message: null,
      },
    ])
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'maria@example.com',
        replyTo: 'joao@example.com',
        documentUrl: expect.stringMatching(/\/d\/tok-mail$/),
        validUntil: '30/11/2026',
        message: 'Qualquer dúvida, me chame.',
      }),
    )
    const [connection, payload, options] = whatsapp.text.mock.calls[0]
    expect(connection).toBe(CONNECTION)
    expect(payload.to).toBe('5511988887777')
    expect(payload.text).toContain('Proposta 2027')
    expect(payload.text).toContain('Qualquer dúvida, me chame.')
    expect(payload.text).toContain('30/11/2026')
    expect(payload.text).toMatch(/\/d\/tok-zap$/)
    expect(options).toEqual({ cost: { source: 'OTHER' } })
    expect(recipientRepo.markSent).toHaveBeenCalledWith('r3', {
      at: AT,
      channel: 'WHATSAPP',
    })
    expect(outcomes[2].recipient.sentAt).toEqual(AT)
  })

  it('does not look up a WhatsApp number when nobody asked for it', async () => {
    await deliverDocument(
      { ...CTX, message: null, validUntil: null },
      [createFakeDocumentRecipient({ channel: 'LINK' })],
      AT,
    )
    expect(lookup.findConnectedWhatsApp).not.toHaveBeenCalled()
  })

  it('falls back to LINK without a connected number or a usable phone', async () => {
    lookup.findConnectedWhatsApp.mockResolvedValue(ok(null))
    const [noConnection] = await deliverDocument(CTX, [zapRecipient()], AT)
    expect(noConnection.delivery).toMatchObject({
      requested: 'WHATSAPP',
      channel: 'LINK',
      delivered: false,
    })
    expect(noConnection.delivery.message).toContain('Nenhum número')

    lookup.findConnectedWhatsApp.mockResolvedValue(err(databaseError()))
    const [lookupFailed] = await deliverDocument(CTX, [zapRecipient()], AT)
    expect(lookupFailed.delivery.channel).toBe('LINK')

    lookup.findConnectedWhatsApp.mockResolvedValue(ok(CONNECTION))
    const [badPhone] = await deliverDocument(
      CTX,
      [zapRecipient('123'), zapRecipient(null)],
      AT,
    )
    expect(badPhone.delivery.message).toContain('telefone')
    expect(whatsapp.text).not.toHaveBeenCalled()
  })

  it('skips WhatsApp and says why when the contact opted out (LGPD)', async () => {
    optOut.mockResolvedValue('opted_out')
    const [outcome] = await deliverDocument(CTX, [zapRecipient()], AT)
    expect(outcome.delivery).toMatchObject({
      requested: 'WHATSAPP',
      channel: 'LINK',
      delivered: false,
    })
    expect(outcome.delivery.message).toContain('LGPD')
    expect(optOut).toHaveBeenCalledWith('ws1', '5511988887777')
    expect(whatsapp.text).not.toHaveBeenCalled()
  })

  it('skips WhatsApp when the opt-out could not be verified', async () => {
    optOut.mockResolvedValue('unverified')
    const [outcome] = await deliverDocument(CTX, [zapRecipient()], AT)
    expect(outcome.delivery.delivered).toBe(false)
    expect(outcome.delivery.message).toContain('confirmar')
    expect(whatsapp.text).not.toHaveBeenCalled()
  })

  it('falls back to LINK when WhatsApp refuses the message', async () => {
    whatsapp.text.mockResolvedValue(err(databaseError()) as never)
    const [outcome] = await deliverDocument(CTX, [zapRecipient()], AT)
    expect(outcome.delivery).toMatchObject({
      channel: 'LINK',
      delivered: false,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'documents.delivery.whatsapp_failed',
      expect.any(Object),
    )
  })

  it('reports a failed e-mail and an e-mail recipient without address', async () => {
    sendEmail
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockRejectedValueOnce('timeout')
    const [failed, missing, odd] = await deliverDocument(
      { ...CTX, message: undefined, validUntil: null },
      [
        mailRecipient('a@example.com'),
        mailRecipient(null),
        mailRecipient('b@example.com'),
      ],
      AT,
    )
    expect(failed.delivery).toMatchObject({
      channel: 'EMAIL',
      delivered: false,
    })
    expect(failed.delivery.message).toContain('e-mail')
    expect(missing.delivery).toMatchObject({
      channel: 'LINK',
      delivered: false,
    })
    expect(odd.delivery.delivered).toBe(false)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ message: null, validUntil: null }),
    )
  })

  it('keeps the original recipient when marking it sent fails', async () => {
    recipientRepo.markSent.mockResolvedValue(err(databaseError()))
    const recipient = createFakeDocumentRecipient({ channel: 'LINK' })
    const [outcome] = await deliverDocument(CTX, [recipient], AT)
    expect(outcome.recipient).toBe(recipient)
  })
})
