import type {
  BannerDocument,
  BannerObjective,
} from '@/src/schemas/crm-banner.schema'
import { solid } from './document'
import {
  BANNER_FORMATS,
  type BannerFormatSpec,
  findBannerFormat,
} from './formats'
import { type BannerContent, type BannerStyle, layoutFormat } from './layout'

/** The workspace brand as the banner builder needs it. */
export interface BannerBrand {
  companyName: string
  logoUrl: string
  primaryColor: string
}

export const DEFAULT_BANNER_BRAND: BannerBrand = {
  companyName: '',
  logoUrl: '',
  primaryColor: '#2563eb',
}

/* --------------------------------- colors -------------------------------- */

function parseHex(color: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(1, 7) : '2563eb'
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  const part = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** `amount` of `other` mixed into `color` (0 = color, 1 = other). */
export function mixColors(color: string, other: string, amount: number) {
  const a = parseHex(color)
  const b = parseHex(other)
  return toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ])
}

/** Relative luminance (0 dark … 1 light). */
export function luminance(color: string): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parseHex(color)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Black or white, whichever reads better over `background`. */
export function readableOn(background: string): string {
  return luminance(background) > 0.42 ? '#111111' : '#ffffff'
}

/* ------------------------------- templates ------------------------------- */

export interface BannerTemplate {
  id: string
  label: string
  description: string
  objectives: BannerObjective[]
  copy: Pick<BannerContent, 'headline' | 'subheadline' | 'cta' | 'badge'>
  /** Needs a photo: the background is the photo. */
  usesPhotoBackground?: boolean
  style: (brand: BannerBrand, imageUrl: string) => BannerStyle
}

const WHITE = '#ffffff'
const INK = '#0f172a'

export const BANNER_TEMPLATES: BannerTemplate[] = [
  {
    id: 'bold-gradient',
    label: 'Degradê da marca',
    description: 'Fundo em degradê com as cores da marca e botão em destaque.',
    objectives: ['LEADS', 'SALES', 'AWARENESS'],
    copy: {
      headline:
        'Fale com a gente e descubra o que dá para fazer pelo seu negócio',
      subheadline: 'Atendimento rápido, sem compromisso.',
      cta: 'Fale conosco',
      badge: '',
    },
    style: (brand) => ({
      background: {
        kind: 'gradient',
        from: brand.primaryColor,
        to: mixColors(brand.primaryColor, '#000000', 0.45),
        angle: 135,
      },
      textColor: readableOn(mixColors(brand.primaryColor, '#000000', 0.2)),
      subColor: readableOn(mixColors(brand.primaryColor, '#000000', 0.2)),
      ctaBackground: solid(WHITE),
      ctaColor: mixColors(brand.primaryColor, '#000000', 0.25),
      badgeBackground: solid('#facc15'),
      badgeColor: INK,
      fontFamily: 'sans',
      headlineWeight: 800,
      align: 'left',
      uppercase: false,
      decor: 'circle',
      decorColor: WHITE,
      imageRadius: 'soft',
    }),
  },
  {
    id: 'clean-light',
    label: 'Claro e limpo',
    description: 'Fundo branco, texto escuro e uma barra na cor da marca.',
    objectives: ['AWARENESS', 'LEADS', 'RETENTION'],
    copy: {
      headline: 'Uma forma mais simples de resolver o que importa',
      subheadline: 'Conheça nossas soluções.',
      cta: 'Saiba mais',
      badge: '',
    },
    style: (brand) => ({
      background: { kind: 'color', color: '#f8fafc' },
      textColor: INK,
      subColor: '#475569',
      ctaBackground: solid(brand.primaryColor),
      ctaColor: readableOn(brand.primaryColor),
      badgeBackground: solid(brand.primaryColor),
      badgeColor: readableOn(brand.primaryColor),
      fontFamily: 'sans',
      headlineWeight: 700,
      align: 'left',
      uppercase: false,
      decor: 'bar',
      decorColor: brand.primaryColor,
      imageRadius: 'soft',
    }),
  },
  {
    id: 'dark-premium',
    label: 'Escuro premium',
    description: 'Fundo escuro com tipografia serifada e acabamento sóbrio.',
    objectives: ['RETENTION', 'AWARENESS', 'SALES'],
    copy: {
      headline: 'Experiência pensada para quem exige mais',
      subheadline: 'Condições exclusivas para clientes.',
      cta: 'Conhecer',
      badge: 'Exclusivo',
    },
    style: (brand) => ({
      background: {
        kind: 'gradient',
        from: '#0b1020',
        to: mixColors('#0b1020', brand.primaryColor, 0.3),
        angle: 160,
      },
      textColor: WHITE,
      subColor: '#cbd5e1',
      ctaBackground: solid(brand.primaryColor),
      ctaColor: readableOn(brand.primaryColor),
      badgeBackground: solid('#ffffff22'),
      badgeColor: WHITE,
      fontFamily: 'serif',
      headlineWeight: 700,
      align: 'left',
      uppercase: false,
      decor: 'band',
      decorColor: brand.primaryColor,
      imageRadius: 'none',
    }),
  },
  {
    id: 'promo-pop',
    label: 'Promoção em destaque',
    description:
      'Amarelo vibrante, letras grandes em caixa alta e selo de oferta.',
    objectives: ['PROMOTION', 'SALES'],
    copy: {
      headline: 'Ofertas imperdíveis só esta semana',
      subheadline: 'Aproveite enquanto durarem os estoques.',
      cta: 'Aproveitar',
      badge: 'Oferta',
    },
    style: () => ({
      background: { kind: 'color', color: '#facc15' },
      textColor: INK,
      subColor: '#422006',
      ctaBackground: solid(INK),
      ctaColor: '#facc15',
      badgeBackground: solid('#dc2626'),
      badgeColor: WHITE,
      fontFamily: 'display',
      headlineWeight: 800,
      align: 'center',
      uppercase: true,
      decor: 'circle',
      decorColor: WHITE,
      imageRadius: 'round',
    }),
  },
  {
    id: 'event-spotlight',
    label: 'Evento',
    description: 'Cor da marca chapada, texto centralizado e selo com a data.',
    objectives: ['EVENT', 'LEADS'],
    copy: {
      headline: 'Participe do nosso evento online',
      subheadline: 'Vagas limitadas. Garanta a sua.',
      cta: 'Quero participar',
      badge: 'Gratuito',
    },
    style: (brand) => ({
      background: { kind: 'color', color: brand.primaryColor },
      textColor: readableOn(brand.primaryColor),
      subColor: readableOn(brand.primaryColor),
      ctaBackground: solid(readableOn(brand.primaryColor)),
      ctaColor: brand.primaryColor,
      badgeBackground: solid('#facc15'),
      badgeColor: INK,
      fontFamily: 'sans',
      headlineWeight: 800,
      align: 'center',
      uppercase: false,
      decor: 'circle',
      decorColor: WHITE,
      imageRadius: 'round',
    }),
  },
  {
    id: 'soft-tint',
    label: 'Tom suave',
    description:
      'Fundo claro tingido pela cor da marca, ideal para relacionamento.',
    objectives: ['RETENTION', 'AWARENESS', 'LEADS'],
    copy: {
      headline: 'Obrigado por fazer parte da nossa história',
      subheadline: 'Preparamos algo especial para você.',
      cta: 'Ver novidades',
      badge: 'Para você',
    },
    style: (brand) => ({
      background: {
        kind: 'color',
        color: mixColors(brand.primaryColor, WHITE, 0.88),
      },
      textColor: mixColors(brand.primaryColor, '#000000', 0.7),
      subColor: mixColors(brand.primaryColor, '#000000', 0.5),
      ctaBackground: solid(brand.primaryColor),
      ctaColor: readableOn(brand.primaryColor),
      badgeBackground: solid(mixColors(brand.primaryColor, WHITE, 0.7)),
      badgeColor: mixColors(brand.primaryColor, '#000000', 0.6),
      fontFamily: 'sans',
      headlineWeight: 700,
      align: 'left',
      uppercase: false,
      decor: 'circle',
      decorColor: brand.primaryColor,
      imageRadius: 'round',
    }),
  },
  {
    id: 'photo-overlay',
    label: 'Foto de fundo',
    description:
      'A imagem escolhida ocupa o fundo, com véu escuro para o texto.',
    objectives: ['AWARENESS', 'PROMOTION', 'EVENT', 'SALES'],
    usesPhotoBackground: true,
    copy: {
      headline: 'Descubra o que preparamos para você',
      subheadline: 'Conheça as novidades.',
      cta: 'Ver agora',
      badge: '',
    },
    style: (brand, imageUrl) => ({
      background: imageUrl
        ? {
            kind: 'image',
            src: imageUrl,
            overlay: '#000000a6',
            fallback: '#0f172a',
          }
        : {
            kind: 'gradient',
            from: '#0f172a',
            to: mixColors('#0f172a', brand.primaryColor, 0.4),
            angle: 135,
          },
      textColor: WHITE,
      subColor: '#e2e8f0',
      ctaBackground: solid(brand.primaryColor),
      ctaColor: readableOn(brand.primaryColor),
      badgeBackground: solid('#facc15'),
      badgeColor: INK,
      fontFamily: 'sans',
      headlineWeight: 800,
      align: 'left',
      uppercase: false,
      decor: 'none',
      decorColor: WHITE,
      imageRadius: 'none',
    }),
  },
]

export function findBannerTemplate(id: string): BannerTemplate | undefined {
  return BANNER_TEMPLATES.find((template) => template.id === id)
}

export function templatesForObjective(
  objective: BannerObjective | null,
): BannerTemplate[] {
  if (!objective) return BANNER_TEMPLATES
  const first = BANNER_TEMPLATES.filter((t) => t.objectives.includes(objective))
  const rest = BANNER_TEMPLATES.filter((t) => !t.objectives.includes(objective))
  return [...first, ...rest]
}

export interface BuildBannerInput {
  template: BannerTemplate
  brand: BannerBrand
  formatIds: string[]
  /** Overrides the template's sample copy. */
  copy?: Partial<BannerContent>
  imageUrl?: string
}

export function resolveFormats(formatIds: string[]): BannerFormatSpec[] {
  const specs = formatIds
    .map((id) => findBannerFormat(id))
    .filter((spec): spec is BannerFormatSpec => Boolean(spec))
  return specs.length > 0 ? specs : BANNER_FORMATS.slice(0, 1)
}

/** A complete banner: the template styled with the brand, in every format. */
export function buildBannerDocument(input: BuildBannerInput): BannerDocument {
  const { template, brand } = input
  const imageUrl = input.imageUrl ?? ''
  const style = template.style(brand, imageUrl)
  const content: BannerContent = {
    ...template.copy,
    logoUrl: brand.logoUrl,
    // The photo-background template uses the photo as the background only.
    imageUrl: template.usesPhotoBackground ? '' : imageUrl,
    ...input.copy,
  }
  return {
    version: 1,
    formats: resolveFormats(input.formatIds).map((spec) =>
      layoutFormat(spec, content, style),
    ),
  }
}
