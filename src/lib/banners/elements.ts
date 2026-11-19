import type {
  BannerElement,
  BannerFormat,
  BannerRole,
} from '@/src/schemas/crm-banner.schema'
import {
  makeButton,
  makeImage,
  makeLogo,
  makeShape,
  makeText,
  solid,
} from './document'

export type NewElementKind = 'text' | 'button' | 'image' | 'logo' | 'shape'

export const NEW_ELEMENT_LABELS: Record<NewElementKind, string> = {
  text: 'Texto',
  button: 'Botão',
  image: 'Imagem',
  logo: 'Logo',
  shape: 'Forma',
}

/**
 * The first element of a kind takes the semantic role (so the layout engine
 * and the A/B text swap know it); the following ones are plain extras.
 */
export function roleForNew(
  format: BannerFormat,
  candidates: BannerRole[],
): BannerRole {
  const taken = new Set(format.elements.map((element) => element.role))
  return candidates.find((role) => !taken.has(role)) ?? 'decor'
}

/** A new element sized for the format, centered, ready to edit. */
export function createElementFor(
  format: BannerFormat,
  kind: NewElementKind,
  options: { src?: string; brandColor?: string } = {},
): BannerElement {
  const short = Math.min(format.width, format.height)
  const centered = (w: number, h: number) => ({
    x: (format.width - w) / 2,
    y: (format.height - h) / 2,
    w,
    h,
  })

  switch (kind) {
    case 'text': {
      const w = Math.min(format.width * 0.7, short * 1.2)
      const fontSize = Math.max(8, short * 0.09)
      return makeText(
        roleForNew(format, ['headline', 'subheadline']),
        'Texto',
        centered(w, fontSize * 1.4),
        { text: 'Novo texto', fontSize, color: '#111111' },
      )
    }
    case 'button': {
      const h = Math.max(14, short * 0.12)
      return makeButton(
        roleForNew(format, ['cta']),
        'Botão',
        centered(Math.min(format.width * 0.6, h * 4), h),
        {
          text: 'Saiba mais',
          fontSize: h * 0.4,
          background: solid(options.brandColor ?? '#2563eb'),
        },
      )
    }
    case 'image': {
      const side = short * 0.5
      return makeImage(
        roleForNew(format, ['image']),
        'Imagem',
        centered(side, side),
        options.src ?? '',
      )
    }
    case 'logo': {
      const h = Math.max(12, short * 0.12)
      return makeLogo('Logo', centered(h * 3, h), options.src ?? '')
    }
    case 'shape':
      return makeShape('decor', 'Forma', centered(short * 0.4, short * 0.4), {
        fill: solid(options.brandColor ?? '#2563eb'),
      })
  }
}
