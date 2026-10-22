/**
 * G.711 μ-law <-> 16-bit linear PCM (ITU-T G.711). The Realtime API speaks
 * μ-law 8 kHz (`audio/pcmu`) and Asterisk's `AudioSocket` speaks signed
 * linear 8 kHz, so a call needs no resampling, only this table codec.
 */
const BIAS = 0x84
const CLIP = 32635

const DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256)
  for (let i = 0; i < 256; i++) {
    const value = ~i & 0xff
    const sign = value & 0x80
    const exponent = (value >> 4) & 0x07
    const mantissa = value & 0x0f
    const magnitude = ((mantissa << 3) + BIAS) << exponent
    table[i] = sign ? BIAS - magnitude : magnitude - BIAS
  }
  return table
})()

function encodeSample(sample: number): number {
  let value = sample
  const sign = value < 0 ? 0x80 : 0
  if (sign) value = -value
  if (value > CLIP) value = CLIP
  value += BIAS
  let exponent = 7
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

/** 16-bit little endian PCM -> μ-law bytes (half the size). */
export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2)
  const out = Buffer.alloc(samples)
  for (let i = 0; i < samples; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2))
  }
  return out
}

/** μ-law bytes -> 16-bit little endian PCM (twice the size). */
export function mulawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2)
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(DECODE_TABLE[mulaw[i]], i * 2)
  }
  return out
}
