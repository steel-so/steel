import { describe, expect, it } from 'vitest'
import {
  addVoiceUsage,
  EMPTY_VOICE_USAGE,
  priceVoiceUsage,
  VOICE_PRICING_USD_PER_1M,
  voiceTokenTotals,
} from '../voice-agent/pricing'
import {
  buildVoiceInstructions,
  DEFAULT_VOICE_NOTICE,
} from '../voice-agent/prompt'

describe('priceVoiceUsage()', () => {
  it('prices audio and text tokens, with the cached share at its own rate', () => {
    const cost = priceVoiceUsage({
      inputAudioTokens: 1000,
      inputTextTokens: 1000,
      cachedInputTokens: 400,
      outputAudioTokens: 500,
      outputTextTokens: 100,
    })
    const p = VOICE_PRICING_USD_PER_1M
    const expected =
      (1000 * p.inputAudio +
        600 * p.inputText +
        400 * p.cachedInput +
        500 * p.outputAudio +
        100 * p.outputText) /
      1_000_000
    expect(cost).toBeCloseTo(expected, 6)
  })

  it('applies the platform margin and never charges negative', () => {
    const usage = { ...EMPTY_VOICE_USAGE, outputAudioTokens: 1_000_000 }
    expect(priceVoiceUsage(usage, 1.5)).toBeCloseTo(96, 6)
    expect(priceVoiceUsage(usage, -3)).toBe(0)
    expect(priceVoiceUsage(usage)).toBeCloseTo(64, 6)
  })

  it('caps the cached tokens at the text input', () => {
    const cost = priceVoiceUsage({
      ...EMPTY_VOICE_USAGE,
      inputTextTokens: 100,
      cachedInputTokens: 500,
    })
    expect(cost).toBeCloseTo(
      (100 * VOICE_PRICING_USD_PER_1M.cachedInput) / 1e6,
      6,
    )
  })
})

describe('voice usage helpers', () => {
  it('adds up responses and reports ledger totals', () => {
    const total = { ...EMPTY_VOICE_USAGE }
    addVoiceUsage(total, {
      inputAudioTokens: 1,
      inputTextTokens: 2,
      cachedInputTokens: 3,
      outputAudioTokens: 4,
      outputTextTokens: 5,
    })
    addVoiceUsage(total, { ...EMPTY_VOICE_USAGE, outputTextTokens: 5 })
    expect(total).toEqual({
      inputAudioTokens: 1,
      inputTextTokens: 2,
      cachedInputTokens: 3,
      outputAudioTokens: 4,
      outputTextTokens: 10,
    })
    expect(voiceTokenTotals(total)).toEqual({
      inputTokens: 3,
      outputTokens: 14,
    })
  })
})

describe('buildVoiceInstructions()', () => {
  const base = {
    workspaceName: 'Stratus',
    instructions: null,
    canOpenTickets: true,
    canLookupTickets: true,
    hasHumanFallback: true,
  }

  it('describes every ability the workspace allowed', () => {
    const text = buildVoiceInstructions(base)
    expect(text).toContain('Stratus')
    expect(text).toContain('open_ticket')
    expect(text).toContain('confirmed=true')
    expect(text).toContain('ticket_status')
    expect(text).toContain('transfer_to_human')
    expect(text).toContain('untrusted_content')
    expect(text).not.toContain('Orientações da empresa')
  })

  it('leaves out disabled abilities and the human hand-off when nobody takes it', () => {
    const text = buildVoiceInstructions({
      ...base,
      canOpenTickets: false,
      canLookupTickets: false,
      hasHumanFallback: false,
      instructions: 'Horário: 8h às 18h',
    })
    expect(text).not.toContain('SEM confirmed')
    expect(text).not.toContain('ticket_status com')
    expect(text).toContain('não há atendente disponível')
    expect(text).toContain('Orientações da empresa:\nHorário: 8h às 18h')
  })

  it('has a default notice that says it is automated', () => {
    expect(DEFAULT_VOICE_NOTICE).toMatch(/automatizado/i)
    expect(DEFAULT_VOICE_NOTICE).toMatch(/inteligência artificial/i)
  })
})
