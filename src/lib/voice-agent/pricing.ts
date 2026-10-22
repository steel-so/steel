import type { VoiceUsage } from './provider'

/**
 * Provider price of the realtime voice model, in US$ per 1M tokens. These
 * are list prices of `gpt-realtime` (2026-10) and are the one place to edit
 * when the provider changes them (ADR 0046). The platform margin is applied
 * on top, like every AI call (ADR 0019).
 */
export const VOICE_PRICING_USD_PER_1M = {
  inputAudio: 32,
  inputText: 4,
  cachedInput: 0.4,
  outputAudio: 64,
  outputText: 16,
} as const

/** Rounded to 6 places, the precision of `ai_usage.cost_usd`. */
export function priceVoiceUsage(usage: VoiceUsage, margin = 1): number {
  const price = VOICE_PRICING_USD_PER_1M
  // Cached tokens are a subset of the input; they are billed at their own
  // price, taken from the text side (audio caching is not itemized).
  const cached = Math.min(
    usage.inputTextTokens,
    Math.max(0, usage.cachedInputTokens),
  )
  const usd =
    (usage.inputAudioTokens * price.inputAudio +
      (usage.inputTextTokens - cached) * price.inputText +
      cached * price.cachedInput +
      usage.outputAudioTokens * price.outputAudio +
      usage.outputTextTokens * price.outputText) /
    1_000_000
  return Math.round(usd * Math.max(0, margin) * 1_000_000) / 1_000_000
}

export const EMPTY_VOICE_USAGE: VoiceUsage = {
  inputAudioTokens: 0,
  inputTextTokens: 0,
  cachedInputTokens: 0,
  outputAudioTokens: 0,
  outputTextTokens: 0,
}

export function addVoiceUsage(total: VoiceUsage, delta: VoiceUsage): void {
  total.inputAudioTokens += delta.inputAudioTokens
  total.inputTextTokens += delta.inputTextTokens
  total.cachedInputTokens += delta.cachedInputTokens
  total.outputAudioTokens += delta.outputAudioTokens
  total.outputTextTokens += delta.outputTextTokens
}

/** Input/output totals as the ledger stores them. */
export function voiceTokenTotals(usage: VoiceUsage): {
  inputTokens: number
  outputTokens: number
} {
  return {
    inputTokens: usage.inputAudioTokens + usage.inputTextTokens,
    outputTokens: usage.outputAudioTokens + usage.outputTextTokens,
  }
}
