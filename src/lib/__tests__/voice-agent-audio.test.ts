import { describe, expect, it } from 'vitest'
import {
  AUDIOSOCKET_MAX_PAYLOAD,
  AudioSocketKind,
  AudioSocketParser,
  encodeAudioFrame,
  encodeFrame,
  encodeHangupFrame,
  UUID_PATTERN,
  uuidFromBytes,
} from '../voice-agent/audiosocket'
import { mulawToPcm16, pcm16ToMulaw } from '../voice-agent/codec'

const UUID_BYTES = Buffer.from('0b6f6f4e7a1d4a589a3e6b5b2f7a9c11', 'hex')
const UUID_TEXT = '0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11'

describe('AudioSocket framing', () => {
  it('encodes kind, big endian length and payload', () => {
    const frame = encodeAudioFrame(Buffer.from([1, 2, 3, 4]))
    expect([...frame]).toEqual([0x10, 0, 4, 1, 2, 3, 4])
    expect([...encodeHangupFrame()]).toEqual([0x00, 0, 0])
  })

  it('refuses a payload that does not fit the 16-bit length', () => {
    expect(() =>
      encodeFrame(
        AudioSocketKind.Audio,
        Buffer.alloc(AUDIOSOCKET_MAX_PAYLOAD + 1),
      ),
    ).toThrow(RangeError)
  })

  it('formats the raw uuid bytes', () => {
    expect(uuidFromBytes(UUID_BYTES)).toBe(UUID_TEXT)
    expect(UUID_PATTERN.test(UUID_TEXT)).toBe(true)
  })
})

describe('AudioSocketParser', () => {
  it('decodes every frame kind', () => {
    const parser = new AudioSocketParser()
    const frames = parser.push(
      Buffer.concat([
        encodeFrame(AudioSocketKind.Uuid, UUID_BYTES),
        encodeFrame(AudioSocketKind.Dtmf, Buffer.from('5')),
        encodeAudioFrame(Buffer.from([9, 9])),
        encodeFrame(AudioSocketKind.Error, Buffer.from([3])),
        encodeFrame(AudioSocketKind.Error, Buffer.alloc(0)),
        encodeFrame(0x77, Buffer.from([1])),
        encodeHangupFrame(),
      ]),
    )
    expect(frames).toEqual([
      { kind: AudioSocketKind.Uuid, uuid: UUID_TEXT },
      { kind: AudioSocketKind.Dtmf, digit: '5' },
      { kind: AudioSocketKind.Audio, audio: Buffer.from([9, 9]) },
      { kind: AudioSocketKind.Error, code: 3 },
      { kind: AudioSocketKind.Error, code: 0 },
      { kind: 'unknown', type: 0x77, payload: Buffer.from([1]) },
      { kind: AudioSocketKind.Hangup },
    ])
  })

  it('reassembles frames split across TCP chunks', () => {
    const parser = new AudioSocketParser()
    const wire = Buffer.concat([
      encodeAudioFrame(Buffer.from([1, 2, 3, 4, 5, 6])),
      encodeAudioFrame(Buffer.from([7, 8])),
    ])
    const frames = [
      ...parser.push(wire.subarray(0, 2)),
      ...parser.push(wire.subarray(2, 6)),
      ...parser.push(wire.subarray(6, 12)),
      ...parser.push(wire.subarray(12)),
    ]
    expect(frames).toEqual([
      { kind: AudioSocketKind.Audio, audio: Buffer.from([1, 2, 3, 4, 5, 6]) },
      { kind: AudioSocketKind.Audio, audio: Buffer.from([7, 8]) },
    ])
  })
})

describe('G.711 mu-law codec', () => {
  it('decodes the reference code points', () => {
    const pcm = mulawToPcm16(Buffer.from([0xff, 0x7f, 0x00, 0x80]))
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(pcm.readInt16LE(2)).toBe(0)
    expect(pcm.readInt16LE(4)).toBe(-32124)
    expect(pcm.readInt16LE(6)).toBe(32124)
  })

  it('round-trips every code with at most the quantization error', () => {
    for (let code = 0; code < 256; code++) {
      const once = mulawToPcm16(Buffer.from([code]))
      const back = pcm16ToMulaw(once)
      const again = mulawToPcm16(back)
      expect(again.readInt16LE(0)).toBe(once.readInt16LE(0))
    }
  })

  it('keeps a sine wave close to the original', () => {
    const samples = 160
    const pcm = Buffer.alloc(samples * 2)
    for (let i = 0; i < samples; i++) {
      pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 12000), i * 2)
    }
    const decoded = mulawToPcm16(pcm16ToMulaw(pcm))
    expect(decoded.length).toBe(pcm.length)
    for (let i = 0; i < samples; i++) {
      const original = pcm.readInt16LE(i * 2)
      const error = Math.abs(decoded.readInt16LE(i * 2) - original)
      expect(error).toBeLessThanOrEqual(Math.max(40, Math.abs(original) * 0.05))
    }
  })

  it('clips samples beyond the codec range', () => {
    const pcm = Buffer.alloc(4)
    pcm.writeInt16LE(32767, 0)
    pcm.writeInt16LE(-32768, 2)
    const decoded = mulawToPcm16(pcm16ToMulaw(pcm))
    expect(decoded.readInt16LE(0)).toBe(32124)
    expect(decoded.readInt16LE(2)).toBe(-32124)
  })

  it('ignores a trailing half sample', () => {
    expect(pcm16ToMulaw(Buffer.alloc(3)).length).toBe(1)
  })
})
