import type {
  BannerDocument,
  BannerElement,
  BannerFormat,
  BannerRole,
} from '@/src/schemas/crm-banner.schema'
import { readCopy } from './document'
import { type BannerFormatSpec, classifyShape } from './formats'
import { type BannerContent, type BannerStyle, layoutFormat } from './layout'

const round = (value: number) => Math.round(value * 100) / 100

/** Scales an element by `sx`/`sy`; type, radius and strokes follow `s`. */
export function scaleElement(
  element: BannerElement,
  sx: number,
  sy: number,
): BannerElement {
  const s = Math.min(sx, sy)
  const box = {
    x: round(element.x * sx),
    y: round(element.y * sy),
    w: Math.max(1, round(element.w * sx)),
    h: Math.max(1, round(element.h * sy)),
  }
  switch (element.type) {
    case 'text':
      return {
        ...element,
        ...box,
        fontSize: round(element.fontSize * s),
        letterSpacing: round(element.letterSpacing * s),
      }
    case 'button':
      return {
        ...element,
        ...box,
        fontSize: round(element.fontSize * s),
        radius: round(element.radius * s),
      }
    case 'shape':
      return {
        ...element,
        ...box,
        radius: round(element.radius * s),
        strokeWidth: round(element.strokeWidth * s),
      }
    case 'image':
    case 'logo':
      return { ...element, ...box, radius: round(element.radius * s) }
  }
}

/** Same-family resize: every element scales with the canvas. */
export function reflowProportional(
  source: BannerFormat,
  target: Pick<BannerFormatSpec, 'id' | 'width' | 'height'>,
): BannerFormat {
  const sx = target.width / source.width
  const sy = target.height / source.height
  return {
    formatId: target.id,
    width: target.width,
    height: target.height,
    background: source.background,
    elements: source.elements.map((element) => scaleElement(element, sx, sy)),
  }
}

function firstByRole(
  format: BannerFormat,
  role: BannerRole,
): BannerElement | undefined {
  return format.elements.find((element) => element.role === role)
}

function opaque(color: string): string {
  return color.slice(0, 7)
}

/** Reads the visual style back from a format, to lay the others out alike. */
export function inferStyle(source: BannerFormat): BannerStyle {
  const headline = firstByRole(source, 'headline')
  const sub = firstByRole(source, 'subheadline')
  const cta = firstByRole(source, 'cta')
  const badge = firstByRole(source, 'badge')
  const image = firstByRole(source, 'image')
  const decor = source.elements.find(
    (element) =>
      element.role === 'decor' && element.type === 'shape' && element.locked,
  )

  const text = headline?.type === 'text' ? headline : null
  const subText = sub?.type === 'text' ? sub : null
  const ctaEl = cta?.type === 'button' ? cta : null
  const badgeEl = badge?.type === 'button' ? badge : null

  let decorKind: BannerStyle['decor'] = 'none'
  let decorColor = '#ffffff'
  if (decor?.type === 'shape') {
    decorColor =
      decor.fill.kind === 'color' ? opaque(decor.fill.color) : '#ffffff'
    if (decor.shape === 'ellipse') decorKind = 'circle'
    else if (decor.h >= source.height * 0.95) decorKind = 'bar'
    else decorKind = 'band'
  }

  let imageRadius: BannerStyle['imageRadius'] = 'none'
  if (image && (image.type === 'image' || image.type === 'logo')) {
    if (image.radius >= Math.min(image.w, image.h) / 2 - 1) {
      imageRadius = 'round'
    } else if (image.radius > 0) imageRadius = 'soft'
  }

  return {
    background: source.background,
    textColor: text?.color ?? '#111111',
    subColor: subText?.color ?? text?.color ?? '#333333',
    ctaBackground: ctaEl?.background ?? { kind: 'color', color: '#2563eb' },
    ctaColor: ctaEl?.color ?? '#ffffff',
    badgeBackground: badgeEl?.background ?? {
      kind: 'color',
      color: '#f59e0b',
    },
    badgeColor: badgeEl?.color ?? '#111111',
    fontFamily: text?.fontFamily ?? 'sans',
    headlineWeight: text?.fontWeight ?? 700,
    align: text?.align === 'center' ? 'center' : 'left',
    uppercase: text?.uppercase ?? false,
    decor: decorKind,
    decorColor,
    imageRadius,
  }
}

export function inferContent(source: BannerFormat): BannerContent {
  const copy = readCopy(source)
  const logo = firstByRole(source, 'logo')
  const image = firstByRole(source, 'image')
  return {
    ...copy,
    logoUrl: logo && 'src' in logo ? logo.src : '',
    imageUrl: image && 'src' in image ? image.src : '',
  }
}

/** Elements the layout engine does not own: added by hand, scaled instead. */
function extras(source: BannerFormat): BannerElement[] {
  const owned = new Set<BannerElement>()
  for (const role of [
    'headline',
    'subheadline',
    'cta',
    'badge',
    'logo',
    'image',
  ] as const) {
    const found = firstByRole(source, role)
    if (found) owned.add(found)
  }
  return source.elements.filter(
    (element) =>
      !owned.has(element) &&
      !(element.role === 'decor' && element.type === 'shape' && element.locked),
  )
}

/**
 * Resizes `source` to `target`. Inside the same shape family the layout is
 * scaled; across families (a square to a 728×90 strip) it is laid out again
 * from the roles of the elements, keeping the style, and hand-made extras are
 * scaled on top. Hidden flags of the owned roles are kept.
 */
export function reflowFormat(
  source: BannerFormat,
  target: BannerFormatSpec,
): BannerFormat {
  const sameFamily =
    classifyShape(source.width, source.height) ===
    classifyShape(target.width, target.height)
  if (sameFamily) return reflowProportional(source, target)

  const laid = layoutFormat(target, inferContent(source), inferStyle(source))
  const hiddenRoles = new Set(
    source.elements.filter((e) => e.hidden).map((e) => e.role),
  )
  const sx = target.width / source.width
  const sy = target.height / source.height
  const owned = laid.elements.map((element) =>
    hiddenRoles.has(element.role) && element.role !== 'decor'
      ? { ...element, hidden: true }
      : element,
  )
  return {
    ...laid,
    elements: [
      ...owned,
      ...extras(source).map((element) => scaleElement(element, sx, sy)),
    ],
  }
}

/** Reflows `sourceId` onto each target; formats already present are replaced. */
export function reflowDocument(
  doc: BannerDocument,
  sourceId: string,
  targets: BannerFormatSpec[],
): BannerDocument {
  const source = doc.formats.find((format) => format.formatId === sourceId)
  if (!source) return doc
  const generated = new Map(
    targets
      .filter((target) => target.id !== sourceId)
      .map((target) => [target.id, reflowFormat(source, target)] as const),
  )
  const formats = doc.formats.map(
    (format) => generated.get(format.formatId) ?? format,
  )
  for (const [id, format] of generated) {
    if (!formats.some((existing) => existing.formatId === id)) {
      formats.push(format)
    }
  }
  return { ...doc, formats }
}
