import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import {
  priceTranscription,
  TRANSCRIPTION_MODEL,
  transcribeAudio,
} from '../ai/transcription'

function client(response: unknown) {
  const create = vi.fn(async () => response)
  return {
    create,
    client: { audio: { transcriptions: { create } } } as unknown as OpenAI,
  }
}

describe('transcribeAudio()', () => {
  it('sends the audio to Whisper and trims the text', async () => {
    const fake = client({ text: '  olá  ', duration: 61.5 })

    expect(
      await transcribeAudio(fake.client, Buffer.from('a'), 'call.wav', {
        language: 'pt',
        withDuration: true,
      }),
    ).toEqual({ text: 'olá', durationSeconds: 61.5 })
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: TRANSCRIPTION_MODEL,
        language: 'pt',
        response_format: 'verbose_json',
      }),
    )
  })

  it('keeps the plain request and has no duration by default', async () => {
    const fake = client({ text: 'oi' })

    expect(
      await transcribeAudio(fake.client, Buffer.from('a'), 'audio.ogg'),
    ).toEqual({ text: 'oi', durationSeconds: null })
    const request = (fake.create.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(request).not.toHaveProperty('response_format')
    expect(request).not.toHaveProperty('language')
  })

  it('returns null for an empty transcription', async () => {
    expect(
      await transcribeAudio(
        client({ text: '  ' }).client,
        Buffer.from('a'),
        'a.wav',
      ),
    ).toBeNull()
    expect(
      await transcribeAudio(client({}).client, Buffer.from('a'), 'a.wav'),
    ).toBeNull()
  })
})

describe('priceTranscription()', () => {
  it('prices per minute with the platform margin', () => {
    expect(priceTranscription(60)).toBe(0.006)
    expect(priceTranscription(90, 2)).toBe(0.018)
    expect(priceTranscription(-5)).toBe(0)
  })
})
