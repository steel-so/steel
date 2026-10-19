import { type OpenAI, toFile } from 'openai'

/**
 * Speech-to-text with OpenAI Whisper, whatever the chat provider of the
 * workspace (Claude does not transcribe audio). Shared by the WhatsApp
 * auto-reply (audio messages) and the call recordings (ADR 0043). The caller
 * resolves the client (`getOpenAiClient()`), so a missing key stays its
 * decision.
 */
export const TRANSCRIPTION_MODEL = 'whisper-1'

/** OpenAI list price of `whisper-1`, per minute of audio (US$). */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006

export interface AudioTranscription {
  text: string
  /** Audio length reported by the provider, when it reports one. */
  durationSeconds: number | null
}

/**
 * Transcribes one audio file. Returns `null` for an empty transcription;
 * provider errors are thrown for the caller to log and degrade.
 */
export async function transcribeAudio(
  client: OpenAI,
  audio: Buffer,
  filename: string,
  options: { language?: string; withDuration?: boolean } = {},
): Promise<AudioTranscription | null> {
  const file = await toFile(audio, filename)
  const response = (await client.audio.transcriptions.create({
    file,
    model: TRANSCRIPTION_MODEL,
    ...(options.language && { language: options.language }),
    ...(options.withDuration && { response_format: 'verbose_json' as const }),
  })) as { text?: string; duration?: number }
  const text = response.text?.trim()
  if (!text) return null
  return {
    text,
    durationSeconds:
      typeof response.duration === 'number' ? response.duration : null,
  }
}

/** Cost (US$) of transcribing `seconds` of audio under the platform margin. */
export function priceTranscription(seconds: number, margin = 1): number {
  const minutes = Math.max(0, seconds) / 60
  return Math.round(minutes * TRANSCRIPTION_USD_PER_MINUTE * margin * 1e6) / 1e6
}
