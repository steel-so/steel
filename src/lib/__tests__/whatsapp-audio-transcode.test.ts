import { describe, expect, it } from 'vitest'
import {
  baseContentType,
  needsAudioTranscode,
} from '@/src/lib/whatsapp/audio-transcode'

describe('baseContentType', () => {
  it('drops the codecs parameter and lower-cases', () => {
    expect(baseContentType('Audio/WebM;codecs=opus')).toBe('audio/webm')
    expect(baseContentType('audio/ogg; codecs=opus')).toBe('audio/ogg')
  })
})

describe('needsAudioTranscode', () => {
  it('converts what Meta refuses (browser recordings, wav, flac)', () => {
    expect(needsAudioTranscode('audio/webm;codecs=opus')).toBe(true)
    expect(needsAudioTranscode('audio/webm')).toBe(true)
    expect(needsAudioTranscode('audio/wav')).toBe(true)
    expect(needsAudioTranscode('audio/x-wav')).toBe(true)
    expect(needsAudioTranscode('audio/flac')).toBe(true)
  })

  it('keeps the formats Meta accepts', () => {
    for (const type of [
      'audio/ogg',
      'audio/ogg; codecs=opus',
      'audio/mpeg',
      'audio/mp4',
      'audio/aac',
      'audio/amr',
    ]) {
      expect(needsAudioTranscode(type)).toBe(false)
    }
  })

  it('ignores everything that is not audio', () => {
    expect(needsAudioTranscode('image/png')).toBe(false)
    expect(needsAudioTranscode('video/webm')).toBe(false)
    expect(needsAudioTranscode('application/pdf')).toBe(false)
  })
})
