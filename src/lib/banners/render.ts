import type {
  BannerBackground,
  BannerElement,
  BannerFill,
  BannerFormat,
} from '@/src/schemas/crm-banner.schema'
import { FONT_STACKS } from './document'

/**
 * Canvas 2D renderer shared by the editor preview, the list thumbnails and
 * the PNG/JPG/WebP export, so what is edited is exactly what is exported
 * (no Chromium, no SVG→image: web fonts of the page are available here).
 */

export type ImageMap = ReadonlyMap<string, HTMLImageElement>

export interface RenderOptions {
  /** Pixels per format pixel. */
  scale: number
  images: ImageMap
  /** Draw a dashed box where an image is still loading or failed. */
  placeholders?: boolean
  /** Element ids to skip (an element being edited in place). */
  skipIds?: ReadonlySet<string>
}

/** CSS-like linear gradient (0° = to top, 90° = to right). */
export function gradientPoints(
  width: number,
  height: number,
  angle: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const radians = (angle * Math.PI) / 180
  const length =
    Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  const dx = (Math.sin(radians) * length) / 2
  const dy = (-Math.cos(radians) * length) / 2
  const cx = width / 2
  const cy = height / 2
  return { x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy }
}

function paintFill(
  ctx: CanvasRenderingContext2D,
  fill: BannerFill | BannerBackground,
  box: { x: number; y: number; w: number; h: number },
): string | CanvasGradient {
  if (fill.kind === 'gradient') {
    const p = gradientPoints(box.w, box.h, fill.angle)
    const gradient = ctx.createLinearGradient(
      box.x + p.x0,
      box.y + p.y0,
      box.x + p.x1,
      box.y + p.y1,
    )
    gradient.addColorStop(0, fill.from)
    gradient.addColorStop(1, fill.to)
    return gradient
  }
  return fill.kind === 'color' ? fill.color : '#ffffff'
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Greedy wrap using the canvas' own measurement. */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

let sansStack: string | null = null

/** next/font hashes the family name; the CSS variable holds the real stack. */
function fontStack(family: keyof typeof FONT_STACKS): string {
  if (family !== 'sans') return FONT_STACKS[family]
  if (sansStack === null) {
    let resolved = ''
    if (typeof document !== 'undefined') {
      resolved = getComputedStyle(document.body)
        .getPropertyValue('--font-geist-sans')
        .trim()
    }
    sansStack = resolved ? `${resolved}, ${FONT_STACKS.sans}` : FONT_STACKS.sans
  }
  return sansStack
}

function setFont(
  ctx: CanvasRenderingContext2D,
  element: {
    fontFamily: keyof typeof FONT_STACKS
    fontSize: number
    fontWeight: number
  },
) {
  ctx.font = `${element.fontWeight} ${element.fontSize}px ${fontStack(element.fontFamily)}`
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // Not in every engine's typings/runtime yet; ignored when absent.
  const target = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in target) target.letterSpacing = `${px}px`
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
) {
  const iw = image.naturalWidth || image.width
  const ih = image.naturalHeight || image.height
  if (!iw || !ih) return
  const scale =
    fit === 'cover'
      ? Math.max(box.w / iw, box.h / ih)
      : Math.min(box.w / iw, box.h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(
    image,
    box.x + (box.w - dw) / 2,
    box.y + (box.h - dh) / 2,
    dw,
    dh,
  )
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: BannerBackground,
  width: number,
  height: number,
  options: RenderOptions,
) {
  const box = { x: 0, y: 0, w: width, h: height }
  if (background.kind === 'image') {
    ctx.fillStyle = background.fallback
    ctx.fillRect(0, 0, width, height)
    const image = options.images.get(background.src)
    if (image) drawCover(ctx, image, box, 'cover')
    ctx.fillStyle = background.overlay
    ctx.fillRect(0, 0, width, height)
    return
  }
  ctx.fillStyle = paintFill(ctx, background, box)
  ctx.fillRect(0, 0, width, height)
}

function drawText(
  ctx: CanvasRenderingContext2D,
  element: Extract<BannerElement, { type: 'text' }>,
) {
  setFont(ctx, element)
  setLetterSpacing(ctx, element.letterSpacing)
  ctx.fillStyle = element.color
  ctx.textBaseline = 'top'
  ctx.textAlign = element.align
  const text = element.uppercase ? element.text.toUpperCase() : element.text
  const lines = wrapLines((t) => ctx.measureText(t).width, text, element.w)
  const lineHeight = element.fontSize * element.lineHeight
  const x =
    element.align === 'left'
      ? 0
      : element.align === 'center'
        ? element.w / 2
        : element.w
  // Half-leading so the text sits in the middle of each line box.
  const lead = (lineHeight - element.fontSize) / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, x, index * lineHeight + lead)
  })
  setLetterSpacing(ctx, 0)
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  element: Extract<BannerElement, { type: 'button' }>,
) {
  roundRectPath(ctx, 0, 0, element.w, element.h, element.radius)
  ctx.fillStyle = paintFill(ctx, element.background, {
    x: 0,
    y: 0,
    w: element.w,
    h: element.h,
  })
  ctx.fill()
  const text = element.uppercase ? element.text.toUpperCase() : element.text
  let size = element.fontSize
  setFont(ctx, { ...element, fontSize: size })
  const maxWidth = element.w * 0.92
  const width = ctx.measureText(text).width
  if (width > maxWidth && width > 0) {
    size = Math.max(4, size * (maxWidth / width))
    setFont(ctx, { ...element, fontSize: size })
  }
  ctx.fillStyle = element.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, element.w / 2, element.h / 2 + size * 0.04)
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  element: Extract<BannerElement, { type: 'shape' }>,
) {
  if (element.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      element.w / 2,
      element.h / 2,
      element.w / 2,
      element.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    roundRectPath(ctx, 0, 0, element.w, element.h, element.radius)
  }
  ctx.fillStyle = paintFill(ctx, element.fill, {
    x: 0,
    y: 0,
    w: element.w,
    h: element.h,
  })
  ctx.fill()
  if (element.strokeWidth > 0) {
    ctx.lineWidth = element.strokeWidth
    ctx.strokeStyle = element.strokeColor
    ctx.stroke()
  }
}

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<BannerElement, { type: 'image' | 'logo' }>,
  options: RenderOptions,
) {
  const image = options.images.get(element.src)
  const box = { x: 0, y: 0, w: element.w, h: element.h }
  if (!image) {
    if (options.placeholders) {
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#94a3b8'
      ctx.fillStyle = '#e2e8f099'
      roundRectPath(ctx, 0, 0, element.w, element.h, element.radius)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    return
  }
  ctx.save()
  if (element.radius > 0) {
    roundRectPath(ctx, 0, 0, element.w, element.h, element.radius)
    ctx.clip()
  }
  drawCover(ctx, image, box, element.fit)
  ctx.restore()
}

/** Draws a format at `options.scale` onto a canvas context. */
export function renderFormat(
  ctx: CanvasRenderingContext2D,
  format: BannerFormat,
  options: RenderOptions,
) {
  ctx.save()
  ctx.scale(options.scale, options.scale)
  ctx.beginPath()
  ctx.rect(0, 0, format.width, format.height)
  ctx.clip()
  drawBackground(ctx, format.background, format.width, format.height, options)

  for (const element of format.elements) {
    if (element.hidden || options.skipIds?.has(element.id)) continue
    ctx.save()
    ctx.translate(element.x + element.w / 2, element.y + element.h / 2)
    if (element.rotation) ctx.rotate((element.rotation * Math.PI) / 180)
    ctx.translate(-element.w / 2, -element.h / 2)
    ctx.globalAlpha = element.opacity
    switch (element.type) {
      case 'text':
        drawText(ctx, element)
        break
      case 'button':
        drawButton(ctx, element)
        break
      case 'shape':
        drawShape(ctx, element)
        break
      case 'image':
      case 'logo':
        drawImageElement(ctx, element, options)
        break
    }
    ctx.restore()
  }
  ctx.restore()
}

/** Every image URL a format needs (elements and background). */
export function imageSources(format: BannerFormat): string[] {
  const urls = new Set<string>()
  if (format.background.kind === 'image' && format.background.src) {
    urls.add(format.background.src)
  }
  for (const element of format.elements) {
    if ((element.type === 'image' || element.type === 'logo') && element.src) {
      urls.add(element.src)
    }
  }
  return [...urls]
}

/* ------------------------------ image loading ----------------------------- */

export interface BannerImageCache {
  /** Loads (once) and resolves the element; `null` when it cannot be read. */
  load: (src: string) => Promise<HTMLImageElement | null>
  /** What is loaded so far. */
  ready: () => Map<string, HTMLImageElement>
}

function loadElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/**
 * Cross-origin media goes through the workspace image proxy, so the export
 * canvas is never tainted; same-origin and data URLs load directly.
 */
export function createImageCache(workspaceId: string): BannerImageCache {
  const pending = new Map<string, Promise<HTMLImageElement | null>>()
  const done = new Map<string, HTMLImageElement>()

  async function fetchImage(src: string): Promise<HTMLImageElement | null> {
    const direct =
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      src.startsWith('/') ||
      src.startsWith(window.location.origin)
    if (direct) return loadElement(src)
    const proxied = await loadElement(
      `/api/workspaces/${workspaceId}/crm/banners/image?url=${encodeURIComponent(src)}`,
    )
    return proxied ?? loadElement(src)
  }

  return {
    load(src) {
      let promise = pending.get(src)
      if (!promise) {
        promise = fetchImage(src).then((image) => {
          if (image) done.set(src, image)
          return image
        })
        pending.set(src, promise)
      }
      return promise
    },
    ready: () => new Map(done),
  }
}

/** Waits for the fonts a format uses (Geist loads lazily on first paint). */
export async function ensureFonts(): Promise<void> {
  try {
    const stack = fontStack('sans')
    await document.fonts.load(`700 20px ${stack}`)
    await document.fonts.load(`400 20px ${stack}`)
    await document.fonts.ready
  } catch {
    // Missing Font Loading API: the fallback stacks still render.
  }
}
