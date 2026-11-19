import type {
  BannerBackground,
  BannerElement,
  BannerFill,
  BannerFontFamily,
  BannerFormat,
} from '@/src/schemas/crm-banner.schema'
import {
  makeButton,
  makeImage,
  makeLogo,
  makeShape,
  makeText,
  solid,
} from './document'
import { type BannerFormatSpec, classifyShape } from './formats'

/** What a banner says and shows, independent of any size. */
export interface BannerContent {
  headline: string
  subheadline: string
  cta: string
  badge: string
  logoUrl: string
  imageUrl: string
}

export interface BannerStyle {
  background: BannerBackground
  textColor: string
  subColor: string
  ctaBackground: BannerFill
  ctaColor: string
  badgeBackground: BannerFill
  badgeColor: string
  fontFamily: BannerFontFamily
  headlineWeight: number
  align: 'left' | 'center'
  uppercase: boolean
  decor: 'none' | 'circle' | 'bar' | 'band'
  decorColor: string
  imageRadius: 'none' | 'soft' | 'round'
}

type Size = Pick<
  BannerFormatSpec,
  'width' | 'height' | 'safeTop' | 'safeBottom'
>

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/* ------------------------------ text metrics ----------------------------- */

/** Average glyph width as a fraction of the font size (sans-serif ballpark). */
function glyphWidth(fontSize: number, weight: number, uppercase: boolean) {
  const factor = 0.52 + (weight >= 700 ? 0.04 : 0) + (uppercase ? 0.1 : 0)
  return fontSize * factor
}

/** Greedy word-wrap line count with the estimated glyph width. */
export function estimateLines(
  text: string,
  fontSize: number,
  boxWidth: number,
  weight = 700,
  uppercase = false,
): number {
  const perLine = Math.max(
    1,
    Math.floor(boxWidth / glyphWidth(fontSize, weight, uppercase)),
  )
  const paragraphs = text.split('\n')
  let lines = 0
  for (const paragraph of paragraphs) {
    let current = 0
    let used = 0
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const length = word.length
      if (used === 0) {
        used = length
        current = 1
      } else if (used + 1 + length <= perLine) {
        used += 1 + length
      } else {
        current += 1
        used = length
      }
      // A word longer than the line breaks into extra lines.
      if (length > perLine) current += Math.ceil(length / perLine) - 1
    }
    lines += Math.max(1, current)
  }
  return lines
}

/** Largest font size (≤ `start`) whose wrapped text fits `boxW × boxH`. */
export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  start: number,
  min: number,
  lineHeight: number,
  weight = 700,
  uppercase = false,
): number {
  let size = Math.max(min, start)
  while (size > min) {
    const lines = estimateLines(text, size, boxW, weight, uppercase)
    if (lines * size * lineHeight <= boxH) break
    size = Math.max(min, Math.floor(size * 0.93 * 10) / 10)
  }
  return Math.round(size * 10) / 10
}

function textHeight(
  text: string,
  fontSize: number,
  boxW: number,
  lineHeight: number,
  weight: number,
  uppercase: boolean,
): number {
  return (
    estimateLines(text, fontSize, boxW, weight, uppercase) *
    fontSize *
    lineHeight
  )
}

function buttonWidth(text: string, fontSize: number, height: number): number {
  return Math.ceil(
    text.length * glyphWidth(fontSize, 700, false) + height * 1.1,
  )
}

/* -------------------------------- layout --------------------------------- */

interface Ctx {
  size: Size
  content: BannerContent
  style: BannerStyle
  /** Content box (inside margins and safe zones). */
  left: number
  top: number
  width: number
  height: number
  margin: number
}

function context(size: Size, content: BannerContent, style: BannerStyle): Ctx {
  const shape = classifyShape(size.width, size.height)
  const short = Math.min(size.width, size.height)
  const margin =
    shape === 'strip'
      ? clamp(size.height * 0.14, 4, 28)
      : clamp(short * 0.07, 8, 84)
  const top = size.height * size.safeTop + margin
  const bottom = size.height * size.safeBottom + margin
  return {
    size,
    content,
    style,
    left: margin,
    top,
    width: size.width - margin * 2,
    height: Math.max(10, size.height - top - bottom),
    margin,
  }
}

function radiusFor(style: BannerStyle, box: { w: number; h: number }) {
  if (style.imageRadius === 'round') return Math.min(box.w, box.h) / 2
  if (style.imageRadius === 'soft') return Math.min(box.w, box.h) * 0.08
  return 0
}

function decorElements(ctx: Ctx): BannerElement[] {
  const { size, style } = ctx
  const color = `${style.decorColor}33`
  if (style.decor === 'circle') {
    const d = Math.min(size.width, size.height) * 0.95
    return [
      makeShape(
        'decor',
        'Círculo decorativo',
        { x: size.width - d * 0.62, y: size.height - d * 0.62, w: d, h: d },
        { shape: 'ellipse', fill: solid(color), locked: true },
      ),
    ]
  }
  if (style.decor === 'bar') {
    const w = Math.max(4, Math.min(size.width, size.height) * 0.025)
    return [
      makeShape(
        'decor',
        'Barra',
        { x: 0, y: 0, w, h: size.height },
        { fill: solid(style.decorColor), locked: true },
      ),
    ]
  }
  if (style.decor === 'band') {
    const h = size.height * 0.34
    return [
      makeShape(
        'decor',
        'Faixa',
        { x: 0, y: size.height - h, w: size.width, h },
        { fill: solid(color), locked: true },
      ),
    ]
  }
  return []
}

interface TextPlan {
  headlineSize: number
  subSize: number
  headlineH: number
  subH: number
}

function planText(
  ctx: Ctx,
  boxW: number,
  boxH: number,
  startSize: number,
  showSub: boolean,
): TextPlan {
  const { content, style } = ctx
  const subShare = showSub && content.subheadline ? 0.3 : 0
  const headlineMaxH = boxH * (1 - subShare)
  const headlineSize = fitFontSize(
    content.headline,
    boxW,
    headlineMaxH,
    startSize,
    7,
    1.1,
    style.headlineWeight,
    style.uppercase,
  )
  const headlineH = textHeight(
    content.headline,
    headlineSize,
    boxW,
    1.1,
    style.headlineWeight,
    style.uppercase,
  )
  let subSize = 0
  let subH = 0
  if (showSub && content.subheadline) {
    subSize = fitFontSize(
      content.subheadline,
      boxW,
      Math.max(8, boxH - headlineH - headlineSize * 0.4),
      headlineSize * 0.46,
      6,
      1.25,
      400,
      false,
    )
    subH = textHeight(content.subheadline, subSize, boxW, 1.25, 400, false)
  }
  return { headlineSize, subSize, headlineH, subH }
}

function pushText(
  out: BannerElement[],
  ctx: Ctx,
  plan: TextPlan,
  box: { x: number; y: number; w: number },
): number {
  const { content, style } = ctx
  let y = box.y
  if (content.headline) {
    out.push(
      makeText(
        'headline',
        'Título',
        { x: box.x, y, w: box.w, h: plan.headlineH },
        {
          text: content.headline,
          fontFamily: style.fontFamily,
          fontSize: plan.headlineSize,
          fontWeight: style.headlineWeight,
          color: style.textColor,
          align: style.align,
          lineHeight: 1.1,
          uppercase: style.uppercase,
        },
      ),
    )
    y += plan.headlineH
  }
  if (content.subheadline && plan.subSize > 0) {
    y += plan.headlineSize * 0.3
    out.push(
      makeText(
        'subheadline',
        'Subtítulo',
        { x: box.x, y, w: box.w, h: plan.subH },
        {
          text: content.subheadline,
          fontFamily: style.fontFamily,
          fontSize: plan.subSize,
          fontWeight: 400,
          color: style.subColor,
          align: style.align,
          lineHeight: 1.25,
        },
      ),
    )
    y += plan.subH
  }
  return y
}

function ctaElement(
  ctx: Ctx,
  box: { x: number; y: number; h: number; maxW: number },
  align: 'left' | 'center' | 'right',
) {
  const { content, style } = ctx
  const fontSize = Math.max(6, box.h * 0.4)
  const w = Math.min(box.maxW, buttonWidth(content.cta, fontSize, box.h))
  const x =
    align === 'left'
      ? box.x
      : align === 'center'
        ? box.x + (box.maxW - w) / 2
        : box.x + box.maxW - w
  return makeButton(
    'cta',
    'Botão',
    { x, y: box.y, w, h: box.h },
    {
      text: content.cta,
      background: style.ctaBackground,
      color: style.ctaColor,
      radius: box.h * 0.3,
      fontFamily: style.fontFamily,
      fontSize,
      fontWeight: 700,
    },
  )
}

function badgeElement(ctx: Ctx, box: { x: number; y: number; h: number }) {
  const { content, style } = ctx
  const fontSize = Math.max(6, box.h * 0.46)
  const w = buttonWidth(content.badge, fontSize, box.h)
  return makeButton(
    'badge',
    'Selo',
    { x: box.x, y: box.y, w, h: box.h },
    {
      text: content.badge,
      background: style.badgeBackground,
      color: style.badgeColor,
      radius: box.h / 2,
      fontFamily: style.fontFamily,
      fontSize,
      fontWeight: 700,
      uppercase: true,
    },
  )
}

function layoutStack(ctx: Ctx): BannerElement[] {
  const { content, style, size, left, top, width, height, margin } = ctx
  const out: BannerElement[] = [...decorElements(ctx)]
  const center = style.align === 'center'
  const tall = classifyShape(size.width, size.height) === 'tall'
  let y = top
  const bottomLimit = top + height

  // CTA anchored at the bottom.
  let ctaH = 0
  if (content.cta) {
    ctaH = clamp(Math.min(size.width, size.height) * 0.11, 16, 150)
  }
  const ctaY = bottomLimit - ctaH

  let logoEl: BannerElement | null = null
  if (content.logoUrl) {
    const h = clamp(height * (tall ? 0.07 : 0.09), 14, 160)
    const w = Math.min(width, h * 3)
    logoEl = makeLogo(
      'Logo',
      { x: center ? left + (width - w) / 2 : left, y, w, h },
      content.logoUrl,
    )
    y += h + margin * 0.5
  }

  if (content.badge) {
    const h = clamp(height * 0.045, 12, 60)
    const badge = badgeElement(ctx, { x: left, y, h })
    badge.x = center ? left + (width - badge.w) / 2 : left
    out.push(badge)
    y += h + margin * 0.4
  }

  const afterTop = y
  const textBottomLimit = ctaH ? ctaY - margin * 0.6 : bottomLimit
  const available = Math.max(20, textBottomLimit - afterTop)
  const wantsImage = Boolean(content.imageUrl)
  const textShare = wantsImage ? 0.5 : 0.85
  const startSize = Math.min(width * (tall ? 0.19 : 0.12), available * 0.2)
  const plan = planText(ctx, width, available * textShare, startSize, true)

  const textEnd = pushText(out, ctx, plan, { x: left, y: afterTop, w: width })

  if (wantsImage) {
    const imageTop = textEnd + margin * 0.6
    const imageH = textBottomLimit - imageTop
    const image = makeImage(
      'image',
      'Imagem',
      { x: left, y: imageTop, w: width, h: Math.max(1, imageH) },
      content.imageUrl,
    )
    image.radius = radiusFor(style, image)
    // Too little room: keep the element (it can be resized by hand) but hide it.
    if (imageH < height * 0.14) image.hidden = true
    out.splice(decorElements(ctx).length, 0, image)
  }

  if (logoEl) out.push(logoEl)
  if (content.cta) {
    out.push(
      ctaElement(
        ctx,
        { x: left, y: ctaY, h: ctaH, maxW: width },
        center ? 'center' : 'left',
      ),
    )
  }
  return out
}

function layoutWide(ctx: Ctx): BannerElement[] {
  const { content, style, left, top, width, height, margin } = ctx
  const out: BannerElement[] = [...decorElements(ctx)]
  const hasImage = Boolean(content.imageUrl)
  const textW = hasImage ? width * 0.56 : width * 0.72
  if (hasImage) {
    const imageW = width - textW - margin
    const image = makeImage(
      'image',
      'Imagem',
      { x: left + textW + margin, y: top, w: imageW, h: height },
      content.imageUrl,
    )
    image.radius = radiusFor(style, image)
    out.push(image)
  }

  const logoH = content.logoUrl ? clamp(height * 0.13, 12, 120) : 0
  const badgeH = content.badge ? clamp(height * 0.09, 12, 48) : 0
  const ctaH = content.cta ? clamp(height * 0.15, 16, 120) : 0
  const gaps = margin * 0.4 * [logoH, badgeH, ctaH].filter(Boolean).length
  const textBox = Math.max(
    20,
    height - logoH - badgeH - ctaH - gaps - margin * 0.4,
  )
  const plan = planText(ctx, textW, textBox, height * 0.2, true)
  const total =
    logoH +
    badgeH +
    plan.headlineH +
    (plan.subH ? plan.headlineSize * 0.3 + plan.subH : 0) +
    ctaH +
    gaps
  let y = top + Math.max(0, (height - total) / 2)

  if (content.logoUrl) {
    out.push(
      makeLogo(
        'Logo',
        { x: left, y, w: Math.min(textW, logoH * 3), h: logoH },
        content.logoUrl,
      ),
    )
    y += logoH + margin * 0.4
  }
  if (content.badge) {
    out.push(badgeElement(ctx, { x: left, y, h: badgeH }))
    y += badgeH + margin * 0.4
  }
  y = pushText(out, ctx, plan, { x: left, y, w: textW }) + margin * 0.4
  if (content.cta) {
    out.push(ctaElement(ctx, { x: left, y, h: ctaH, maxW: textW }, 'left'))
  }
  return out
}

function layoutStrip(ctx: Ctx): BannerElement[] {
  const { content, style, size, left, margin } = ctx
  const out: BannerElement[] = [...decorElements(ctx)]
  const innerH = size.height - margin * 2
  const rowY = margin
  let x = left
  let right = size.width - margin
  const gap = margin * 1.2

  if (content.logoUrl) {
    const w = Math.min(innerH * 2.6, size.width * 0.22)
    out.push(makeLogo('Logo', { x, y: rowY, w, h: innerH }, content.logoUrl))
    x += w + gap
  }

  if (content.cta) {
    const h = clamp(innerH * (innerH > 70 ? 0.4 : 0.62), 14, 90)
    const cta = ctaElement(
      ctx,
      { x: right - 10, y: rowY + (innerH - h) / 2, h, maxW: size.width * 0.3 },
      'right',
    )
    cta.x = right - cta.w
    out.push(cta)
    right = cta.x - gap
  }

  if (content.imageUrl && size.width >= 480) {
    const side = innerH
    const image = makeImage(
      'image',
      'Imagem',
      { x: right - side, y: rowY, w: side, h: side },
      content.imageUrl,
    )
    image.radius = radiusFor(style, image)
    out.push(image)
    right -= side + gap
  }

  if (content.badge && innerH >= 70 && right - x > 200) {
    const h = clamp(innerH * 0.16, 12, 28)
    out.push(badgeElement(ctx, { x, y: rowY, h }))
  }

  const textW = Math.max(30, right - x)
  const showSub = innerH >= 80 && Boolean(content.subheadline)
  const plan = planText(ctx, textW, innerH, innerH * 0.5, showSub)
  const total =
    plan.headlineH + (plan.subH ? plan.headlineSize * 0.3 + plan.subH : 0)
  const y = rowY + Math.max(0, (innerH - total) / 2)
  pushText(out, ctx, plan, { x, y, w: textW })
  return out
}

/** Builds one format from the content, with the layout for its shape. */
export function layoutFormat(
  spec: Size & { id: string },
  content: BannerContent,
  style: BannerStyle,
): BannerFormat {
  const ctx = context(spec, content, style)
  const shape = classifyShape(spec.width, spec.height)
  const elements =
    shape === 'strip'
      ? layoutStrip(ctx)
      : shape === 'wide'
        ? layoutWide(ctx)
        : layoutStack(ctx)
  return {
    formatId: spec.id,
    width: spec.width,
    height: spec.height,
    background: style.background,
    elements,
  }
}
