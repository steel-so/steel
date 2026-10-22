import { describe, expect, it } from 'vitest'
import {
  createFakePhoneCallWithNames,
  createFakeWhatsAppPhoneCall,
} from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import {
  toPhoneCallRecordDTO,
  toWhatsAppPhoneCallDTO,
} from '../whatsapp-phone-call.mapper'

describe('toWhatsAppPhoneCallDTO()', () => {
  it('maps a finished call without leaking the callback hash', () => {
    const answeredAt = new Date('2026-10-13T12:00:00.000Z')
    const endedAt = new Date('2026-10-13T12:00:42.000Z')
    const call = createFakeWhatsAppPhoneCall({
      status: 'COMPLETED',
      answeredAt,
      endedAt,
      durationSeconds: 42,
    })

    const dto = toWhatsAppPhoneCallDTO(call)

    expect(dto).toEqual({
      id: call.id,
      conversationId: call.conversationId,
      direction: 'OUTBOUND',
      source: 'CLICK_TO_CALL',
      userId: call.userId,
      extension: '200',
      destination: '11999999999',
      status: 'COMPLETED',
      answeredAt: '2026-10-13T12:00:00.000Z',
      endedAt: '2026-10-13T12:00:42.000Z',
      durationSeconds: 42,
      createdAt: call.createdAt.toISOString(),
      recordingNotice: null,
      hasRecording: false,
      aiStatus: 'NONE',
    })
    expect(dto).not.toHaveProperty('callbackTokenHash')
  })

  it('keeps the open timestamps null', () => {
    const dto = toWhatsAppPhoneCallDTO(createFakeWhatsAppPhoneCall())
    expect(dto).toMatchObject({ answeredAt: null, endedAt: null })
  })

  it('shows the recording notice only on calls that asked for a recording', () => {
    expect(
      toWhatsAppPhoneCallDTO(
        createFakeWhatsAppPhoneCall({
          recordingRequested: true,
          recordingNotice: 'Ligação gravada',
        }),
      ).recordingNotice,
    ).toBe('Ligação gravada')
    expect(
      toWhatsAppPhoneCallDTO(
        createFakeWhatsAppPhoneCall({
          recordingRequested: false,
          recordingNotice: 'stale',
        }),
      ).recordingNotice,
    ).toBeNull()
  })
})

describe('toPhoneCallRecordDTO()', () => {
  it('maps the recording, the AI fields, the links and the names', () => {
    const expiresAt = new Date('2027-01-16T03:00:00.000Z')
    const processedAt = new Date('2026-10-18T12:05:00.000Z')
    const dto = toPhoneCallRecordDTO(
      createFakePhoneCallWithNames(
        {
          status: 'COMPLETED',
          recordingKey: 'ws1/call1.mp3',
          recordingMimeType: 'audio/mpeg',
          recordingSizeBytes: 1234,
          recordingExpiresAt: expiresAt,
          aiStatus: 'DONE',
          transcript: 'Olá',
          summary: 'Cliente pediu boleto',
          sentiment: 'POSITIVE',
          sentimentScore: 0.5,
          nextSteps: ['Enviar o boleto'],
          aiModel: 'openai:gpt-4.1-mini',
          aiProcessedAt: processedAt,
          sdTicketId: 't1',
          crmPersonId: 'p1',
          crmOpportunityId: 'o1',
        },
        { userName: 'Ana', contactName: 'Maria' },
      ),
    )

    expect(dto).toMatchObject({
      hasRecording: true,
      aiStatus: 'DONE',
      userName: 'Ana',
      contactName: 'Maria',
      recording: {
        mimeType: 'audio/mpeg',
        sizeBytes: 1234,
        expiresAt: expiresAt.toISOString(),
      },
      transcript: 'Olá',
      summary: 'Cliente pediu boleto',
      sentiment: 'POSITIVE',
      sentimentScore: 0.5,
      nextSteps: ['Enviar o boleto'],
      aiModel: 'openai:gpt-4.1-mini',
      aiSkipReason: null,
      aiProcessedAt: processedAt.toISOString(),
      sdTicketId: 't1',
      crmPersonId: 'p1',
      crmOpportunityId: 'o1',
    })
  })

  it('describes a browser phone call with no conversation by the caller name', () => {
    const base = createFakePhoneCallWithNames({
      conversationId: null,
      direction: 'INBOUND',
      source: 'WEBPHONE',
      remoteName: 'Maria da Silva',
    })
    const dto = toPhoneCallRecordDTO({ ...base, conversation: null })
    expect(dto).toMatchObject({
      conversationId: null,
      direction: 'INBOUND',
      source: 'WEBPHONE',
      contactName: 'Maria da Silva',
    })

    const unnamed = toPhoneCallRecordDTO({
      ...base,
      remoteName: null,
      conversation: null,
    })
    expect(unnamed.contactName).toBeNull()
  })

  it('has no recording block without a stored object', () => {
    const dto = toPhoneCallRecordDTO(
      createFakePhoneCallWithNames(
        { recordingKey: 'ws1/c.wav', recordingMimeType: null },
        { userName: null },
      ),
    )
    expect(dto.recording).toBeNull()
    expect(dto.userName).toBeNull()
    expect(dto.aiProcessedAt).toBeNull()
  })

  it('defaults a missing size and expiry', () => {
    const dto = toPhoneCallRecordDTO(
      createFakePhoneCallWithNames({
        recordingKey: 'ws1/c.wav',
        recordingMimeType: 'audio/wav',
      }),
    )
    expect(dto.recording).toEqual({
      mimeType: 'audio/wav',
      sizeBytes: 0,
      expiresAt: null,
    })
  })
})
