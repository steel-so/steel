/**
 * Normalizes CSS computed colors to `#rrggbb`. Chromium reports `rgb()` /
 * `rgba()` for legacy colors but keeps `color()`, `oklab()` and `oklch()`
 * as authored, so those are converted too.
 */

export interface NormalizedColor {
  /** `#rrggbb`, or `transparent` when fully transparent. */
  hex: string
  alpha: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

function toHexByte(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, '0')
}

function toHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

/** One channel: `12`, `50%` (of `scale`), `none`. */
function channel(token: string, scale: number): number | null {
  if (token === 'none') return 0
  const n = Number.parseFloat(token)
  if (!Number.isFinite(n)) return null
  return token.endsWith('%') ? (n / 100) * scale : n
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1
  const value = channel(token, 1)
  return value === null ? null : clamp(value, 0, 1)
}

/** Splits `fn(a b c / d)` or `fn(a, b, c, d)` into its tokens. */
function args(input: string): string[] | null {
  const open = input.indexOf('(')
  const close = input.lastIndexOf(')')
  if (open < 0 || close < open) return null
  return input
    .slice(open + 1, close)
    .replace(/[,/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function linearToSrgb(value: number): number {
  const v = clamp(value, 0, 1)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

function oklabToRgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const lc = l_ ** 3
  const mc = m_ ** 3
  const sc = s_ ** 3
  const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc
  return [linearToSrgb(r) * 255, linearToSrgb(g) * 255, linearToSrgb(bl) * 255]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  const sat = clamp(s, 0, 1)
  const light = clamp(l, 0, 1)
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255]
}

function finish(
  r: number,
  g: number,
  b: number,
  alpha: number,
): NormalizedColor {
  if (alpha <= 0.01) return { hex: 'transparent', alpha: 0 }
  return { hex: toHex(r, g, b), alpha: Math.round(alpha * 100) / 100 }
}

function parseHex(text: string): NormalizedColor | null {
  const match = /^#([0-9a-f]{3,8})$/.exec(text)
  if (!match) return null
  let digits = match[1]
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (digits.length !== 6 && digits.length !== 8) return null
  const r = Number.parseInt(digits.slice(0, 2), 16)
  const g = Number.parseInt(digits.slice(2, 4), 16)
  const b = Number.parseInt(digits.slice(4, 6), 16)
  const alpha =
    digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return finish(r, g, b, alpha)
}

export function parseColor(input: string): NormalizedColor | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  if (text === 'transparent') return { hex: 'transparent', alpha: 0 }
  if (text.startsWith('#')) return parseHex(text)

  const tokens = args(text)
  if (!tokens) return null
  const fn = text.slice(0, text.indexOf('(')).trim()

  if (fn === 'rgb' || fn === 'rgba') {
    const r = channel(tokens[0] ?? '', 255)
    const g = channel(tokens[1] ?? '', 255)
    const b = channel(tokens[2] ?? '', 255)
    const alpha = alphaOf(tokens[3])
    if (r === null || g === null || b === null || alpha === null) return null
    return finish(r, g, b, alpha)
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const h = channel(tokens[0]?.replace('deg', '') ?? '', 360)
    const s = channel(tokens[1] ?? '', 1)
    const l = channel(tokens[2] ?? '', 1)
    const alpha = alphaOf(tokens[3])
    if (h === null || s === null || l === null || alpha === null) return null
    // Bare numbers in saturation/lightness are percentages (0-100).
    const sat = tokens[1]?.endsWith('%') ? s : s / 100
    const light = tokens[2]?.endsWith('%') ? l : l / 100
    const [r, g, b] = hslToRgb(h, sat, light)
    return finish(r, g, b, alpha)
  }
  if (fn === 'oklab' || fn === 'oklch') {
    const lum = channel(tokens[0] ?? '', 1)
    const second = channel(tokens[1] ?? '', 0.4)
    const third = channel(tokens[2]?.replace('deg', '') ?? '', 0.4)
    const alpha = alphaOf(tokens[3])
    if (lum === null || second === null || third === null || alpha === null) {
      return null
    }
    let a = second
    let b = third
    if (fn === 'oklch') {
      const hue = (third * Math.PI) / 180
      a = second * Math.cos(hue)
      b = second * Math.sin(hue)
    }
    const [r, g, bl] = oklabToRgb(lum, a, b)
    return finish(r, g, bl, alpha)
  }
  if (fn === 'color') {
    if (tokens[0] !== 'srgb') return null
    const r = channel(tokens[1] ?? '', 1)
    const g = channel(tokens[2] ?? '', 1)
    const b = channel(tokens[3] ?? '', 1)
    const alpha = alphaOf(tokens[4])
    if (r === null || g === null || b === null || alpha === null) return null
    return finish(r * 255, g * 255, b * 255, alpha)
  }
  return null
}

/** `#rrggbb` (or `transparent`), or null when the text is not a color. */
export function normalizeColor(input: string): string | null {
  return parseColor(input)?.hex ?? null
}
