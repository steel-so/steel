import { createId } from '@paralleldrive/cuid2'
import type {
  BannerBackground,
  BannerButtonElement,
  BannerDocument,
  BannerElement,
  BannerFill,
  BannerFontFamily,
  BannerFormat,
  BannerImageElement,
  BannerLogoElement,
  BannerRole,
  BannerShapeElement,
  BannerTextElement,
} from '@/src/schemas/crm-banner.schema'

export type {
  BannerBackground,
  BannerDocument,
  BannerElement,
  BannerFormat,
  BannerRole,
}

type Box = { x: number; y: number; w: number; h: number }

const round = (value: number) => Math.round(value * 100) / 100

function base(role: BannerRole, name: string, box: Box) {
  return {
    id: createId(),
    name,
    role,
    x: round(box.x),
    y: round(box.y),
    w: Math.max(1, round(box.w)),
    h: Math.max(1, round(box.h)),
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  }
}

export function makeText(
  role: BannerRole,
  name: string,
  box: Box,
  props: Partial<
    Omit<BannerTextElement, 'type' | 'id' | 'x' | 'y' | 'w' | 'h' | 'role'>
  > & { text: string },
): BannerTextElement {
  return {
    ...base(role, name, box),
    type: 'text',
    fontFamily: 'sans',
    fontSize: 32,
    fontWeight: 700,
    color: '#111111',
    align: 'left',
    lineHeight: 1.1,
    letterSpacing: 0,
    uppercase: false,
    ...props,
  }
}

export function makeButton(
  role: BannerRole,
  name: string,
  box: Box,
  props: Partial<
    Omit<BannerButtonElement, 'type' | 'id' | 'x' | 'y' | 'w' | 'h' | 'role'>
  > & { text: string },
): BannerButtonElement {
  return {
    ...base(role, name, box),
    type: 'button',
    background: { kind: 'color', color: '#2563eb' },
    color: '#ffffff',
    radius: 999,
    fontFamily: 'sans',
    fontSize: 20,
    fontWeight: 700,
    uppercase: false,
    ...props,
  }
}

export function makeShape(
  role: BannerRole,
  name: string,
  box: Box,
  props: Partial<
    Omit<BannerShapeElement, 'type' | 'id' | 'x' | 'y' | 'w' | 'h' | 'role'>
  > = {},
): BannerShapeElement {
  return {
    ...base(role, name, box),
    type: 'shape',
    shape: 'rect',
    fill: { kind: 'color', color: '#00000022' },
    radius: 0,
    strokeColor: '#000000',
    strokeWidth: 0,
    ...props,
  }
}

export function makeImage(
  role: BannerRole,
  name: string,
  box: Box,
  src: string,
  props: Partial<Pick<BannerImageElement, 'fit' | 'radius' | 'alt'>> = {},
): BannerImageElement {
  return {
    ...base(role, name, box),
    type: 'image',
    src,
    fit: 'cover',
    radius: 0,
    alt: '',
    ...props,
  }
}

export function makeLogo(
  name: string,
  box: Box,
  src: string,
  alt = 'Logo',
): BannerLogoElement {
  return {
    ...base('logo', name, box),
    type: 'logo',
    src,
    fit: 'contain',
    radius: 0,
    alt,
  }
}

export function solid(color: string): BannerFill {
  return { kind: 'color', color }
}

/* ----------------------------- document ops ----------------------------- */

export function findFormat(
  doc: BannerDocument,
  formatId: string,
): BannerFormat | undefined {
  return doc.formats.find((format) => format.formatId === formatId)
}

export function replaceFormat(
  doc: BannerDocument,
  next: BannerFormat,
): BannerDocument {
  return {
    ...doc,
    formats: doc.formats.map((format) =>
      format.formatId === next.formatId ? next : format,
    ),
  }
}

export function updateElement(
  format: BannerFormat,
  elementId: string,
  patch: Record<string, unknown>,
): BannerFormat {
  return {
    ...format,
    elements: format.elements.map((element) =>
      element.id === elementId
        ? ({ ...element, ...patch } as BannerElement)
        : element,
    ),
  }
}

export function removeElement(
  format: BannerFormat,
  elementId: string,
): BannerFormat {
  return {
    ...format,
    elements: format.elements.filter((element) => element.id !== elementId),
  }
}

/** Moves an element one step in the stacking order (+1 up, -1 down). */
export function moveElementOrder(
  format: BannerFormat,
  elementId: string,
  direction: 1 | -1,
): BannerFormat {
  const index = format.elements.findIndex((element) => element.id === elementId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= format.elements.length) return format
  const elements = [...format.elements]
  const [moved] = elements.splice(index, 1)
  if (!moved) return format
  elements.splice(target, 0, moved)
  return { ...format, elements }
}

export function duplicateElement(
  format: BannerFormat,
  elementId: string,
  offset = 12,
): { format: BannerFormat; id: string | null } {
  const source = format.elements.find((element) => element.id === elementId)
  if (!source) return { format, id: null }
  const copy = {
    ...source,
    id: createId(),
    x: source.x + offset,
    y: source.y + offset,
  } as BannerElement
  return {
    format: { ...format, elements: [...format.elements, copy] },
    id: copy.id,
  }
}

/** Current copy of the banner, read from the elements by role. */
export function readCopy(format: BannerFormat): {
  headline: string
  subheadline: string
  cta: string
  badge: string
} {
  const text = (role: BannerRole): string => {
    const element = format.elements.find(
      (candidate) =>
        candidate.role === role &&
        (candidate.type === 'text' || candidate.type === 'button'),
    )
    return element && (element.type === 'text' || element.type === 'button')
      ? element.text
      : ''
  }
  return {
    headline: text('headline'),
    subheadline: text('subheadline'),
    cta: text('cta'),
    badge: text('badge'),
  }
}

/** Writes new copy into every format, by role (A/B variants, AI text). */
export function applyCopy(
  doc: BannerDocument,
  copy: Partial<ReturnType<typeof readCopy>>,
): BannerDocument {
  const roles: Array<[BannerRole, string | undefined]> = [
    ['headline', copy.headline],
    ['subheadline', copy.subheadline],
    ['cta', copy.cta],
    ['badge', copy.badge],
  ]
  return {
    ...doc,
    formats: doc.formats.map((format) => ({
      ...format,
      elements: format.elements.map((element) => {
        if (element.type !== 'text' && element.type !== 'button') return element
        const entry = roles.find(([role]) => role === element.role)
        if (!entry || entry[1] === undefined) return element
        return { ...element, text: entry[1] }
      }),
    })),
  }
}

export const FONT_STACKS: Record<BannerFontFamily, string> = {
  sans: 'Geist, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", ui-monospace, monospace',
  display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
}

export const FONT_LABELS: Record<BannerFontFamily, string> = {
  sans: 'Moderna (Geist)',
  serif: 'Clássica (serifada)',
  mono: 'Técnica (monoespaçada)',
  display: 'Impactante',
}
