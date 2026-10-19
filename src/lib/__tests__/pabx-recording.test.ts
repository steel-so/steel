import { describe, expect, it } from 'vitest'
import {
  callIdFromRecordingKey,
  phoneMatchKey,
  recordingObjectKey,
  sniffRecordingFormat,
} from '../pabx/recording'

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) =>
      typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v],
    ),
  )

describe('sniffRecordingFormat()', () => {
  it('recognizes WAV, OGG and MP3 by their bytes', () => {
    expect(sniffRecordingFormat(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toEqual({
      mimeType: 'audio/wav',
      ext: 'wav',
    })
    expect(sniffRecordingFormat(bytes('OggS', 0))).toEqual({
      mimeType: 'audio/ogg',
      ext: 'ogg',
    })
    expect(sniffRecordingFormat(bytes('ID3', 4))).toEqual({
      mimeType: 'audio/mpeg',
      ext: 'mp3',
    })
    expect(sniffRecordingFormat(bytes(0xff, 0xfb, 0x90))).toEqual({
      mimeType: 'audio/mpeg',
      ext: 'mp3',
    })
  })

  it('rejects everything else', () => {
    expect(sniffRecordingFormat(bytes('RIFF', 0, 0, 0, 0, 'AVI '))).toBeNull()
    expect(sniffRecordingFormat(bytes('<?ph'))).toBeNull()
    // MPEG sync with the reserved layer bits.
    expect(sniffRecordingFormat(bytes(0xff, 0xe0))).toBeNull()
    expect(sniffRecordingFormat(bytes(0xff))).toBeNull()
    expect(sniffRecordingFormat(new Uint8Array())).toBeNull()
  })
})

describe('recording object keys', () => {
  it('round-trips the call id', () => {
    const key = recordingObjectKey('ws1', 'call1', 'mp3')
    expect(key).toBe('ws1/call1.mp3')
    expect(callIdFromRecordingKey(key)).toBe('call1')
    expect(callIdFromRecordingKey('loose.mp3')).toBeNull()
  })
})

describe('phoneMatchKey()', () => {
  it('matches a number with and without 55 and the ninth digit', () => {
    expect(phoneMatchKey('5511999998888')).toBe('1199998888')
    expect(phoneMatchKey('(11) 99999-8888')).toBe('1199998888')
    expect(phoneMatchKey('551199998888')).toBe('1199998888')
    expect(phoneMatchKey('1133334444')).toBe('1133334444')
  })

  it('returns null for something that is not a national number', () => {
    expect(phoneMatchKey('200')).toBeNull()
    expect(phoneMatchKey('+1 202 555 0123 99')).toBeNull()
  })
})
