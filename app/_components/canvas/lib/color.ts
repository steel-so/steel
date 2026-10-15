/** Color math for the inspector color picker (hex ⇄ RGBA ⇄ HSV). */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

export interface Hsva {
  /** 0..360 */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  v: number
  /** 0..1 */
  a: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Parses `#RGB`, `#RRGGBB` or `#RRGGBBAA` (with or without `#`). */
export function parseHex(input: string): Rgba | null {
  const match = HEX.exec(input.trim())
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

const byte = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0')

/** `#RRGGBB`, or `#RRGGBBAA` when not opaque. Upper-case. */
export function toHex({ r, g, b, a }: Rgba): string {
  const alpha = a >= 0.999 ? '' : byte(a * 255)
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha}`.toUpperCase()
}

export function rgbaToHsva({ r, g, b, a }: Rgba): Hsva {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a }
}

export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
    a,
  }
}

export const RECENT_COLORS_KEY = 'steel.canvas.recent-colors'
export const RECENT_COLORS_MAX = 10

export function readRecentColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/** Puts `color` first in the recent list (deduplicated, capped). */
export function pushRecentColor(color: string): string[] {
  const next = [
    color,
    ...readRecentColors().filter((item) => item !== color),
  ].slice(0, RECENT_COLORS_MAX)
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next))
  } catch {
    // Private mode / blocked storage: recent colors are a convenience.
  }
  return next
}
