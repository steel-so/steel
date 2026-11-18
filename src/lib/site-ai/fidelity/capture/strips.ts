/** Strip planning and JPEG fitting for the reference capture. */

export const STRIP_HEIGHT = 1100
export const MAX_DESKTOP_STRIPS = 8
export const MAX_MOBILE_STRIPS = 4
/** Max length of one `data:image/jpeg;base64,…` string. */
export const MAX_STRIP_CHARS = 1_400_000
/** JPEG qualities tried in order until the data URL fits. */
export const JPEG_QUALITY_LADDER = [78, 62, 48, 34, 22, 12] as const

export interface StripRect {
  y: number
  height: number
}

/** Vertical bands, top to bottom; the page is cut after `maxStrips`. */
export function planStrips(
  pageHeight: number,
  maxStrips: number,
  stripHeight: number = STRIP_HEIGHT,
): StripRect[] {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0 || maxStrips <= 0) {
    return []
  }
  const total = Math.floor(pageHeight)
  const strips: StripRect[] = []
  for (let y = 0; y < total && strips.length < maxStrips; y += stripHeight) {
    strips.push({ y, height: Math.min(stripHeight, total - y) })
  }
  return strips
}

export function jpegDataUrl(bytes: Uint8Array | Buffer): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
}

/**
 * Encodes with decreasing quality until the data URL fits `maxChars`.
 * Returns null when even the lowest quality is too large.
 */
export async function fitJpeg(
  encode: (quality: number) => Promise<Uint8Array | Buffer>,
  maxChars: number = MAX_STRIP_CHARS,
): Promise<string | null> {
  for (const quality of JPEG_QUALITY_LADDER) {
    const url = jpegDataUrl(await encode(quality))
    if (url.length <= maxChars) return url
  }
  return null
}
