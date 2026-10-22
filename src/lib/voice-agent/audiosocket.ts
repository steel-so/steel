/**
 * Asterisk `AudioSocket` wire protocol (ADR 0046). Every frame is
 * `kind (1 byte) + payload length (2 bytes, big endian) + payload`. The call
 * audio is signed linear PCM, 16-bit little endian, mono, 8 kHz.
 */
export const AudioSocketKind = {
  Hangup: 0x00,
  Uuid: 0x01,
  Dtmf: 0x03,
  Audio: 0x10,
  Error: 0xff,
} as const

export type AudioSocketFrame =
  | { kind: typeof AudioSocketKind.Hangup }
  | { kind: typeof AudioSocketKind.Uuid; uuid: string }
  | { kind: typeof AudioSocketKind.Dtmf; digit: string }
  | { kind: typeof AudioSocketKind.Audio; audio: Buffer }
  | { kind: typeof AudioSocketKind.Error; code: number }
  | { kind: 'unknown'; type: number; payload: Buffer }

/** Biggest payload a frame can carry (the length field has 16 bits). */
export const AUDIOSOCKET_MAX_PAYLOAD = 0xffff

/** Bytes of one 20 ms frame of 8 kHz 16-bit mono audio. */
export const AUDIO_FRAME_BYTES = 320

export function encodeFrame(kind: number, payload: Buffer): Buffer {
  if (payload.length > AUDIOSOCKET_MAX_PAYLOAD) {
    throw new RangeError('AudioSocket payload too large')
  }
  const header = Buffer.alloc(3)
  header.writeUInt8(kind, 0)
  header.writeUInt16BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

export const encodeAudioFrame = (audio: Buffer): Buffer =>
  encodeFrame(AudioSocketKind.Audio, audio)

export const encodeHangupFrame = (): Buffer =>
  encodeFrame(AudioSocketKind.Hangup, Buffer.alloc(0))

/** Canonical lower-case UUID text of the 16 raw bytes of a UUID frame. */
export function uuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function toFrame(type: number, payload: Buffer): AudioSocketFrame {
  switch (type) {
    case AudioSocketKind.Hangup:
      return { kind: AudioSocketKind.Hangup }
    case AudioSocketKind.Uuid:
      return { kind: AudioSocketKind.Uuid, uuid: uuidFromBytes(payload) }
    case AudioSocketKind.Dtmf:
      return { kind: AudioSocketKind.Dtmf, digit: payload.toString('ascii') }
    case AudioSocketKind.Audio:
      return { kind: AudioSocketKind.Audio, audio: payload }
    case AudioSocketKind.Error:
      return { kind: AudioSocketKind.Error, code: payload[0] ?? 0 }
    default:
      return { kind: 'unknown', type, payload }
  }
}

/**
 * Incremental frame decoder: TCP delivers arbitrary chunks, so a frame may
 * arrive split or glued to the next one.
 */
export class AudioSocketParser {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): AudioSocketFrame[] {
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const frames: AudioSocketFrame[] = []
    while (this.pending.length >= 3) {
      const length = this.pending.readUInt16BE(1)
      if (this.pending.length < 3 + length) break
      frames.push(
        toFrame(
          this.pending.readUInt8(0),
          this.pending.subarray(3, 3 + length),
        ),
      )
      this.pending = this.pending.subarray(3 + length)
    }
    return frames
  }
}
