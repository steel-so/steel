import {
  type ComponentType,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import type {
  CanvasRenderProps,
  CustomControlProps,
  InspectorField,
  InspectorSection,
} from '@/src/lib/canvas/registry'
import type { CanvasNode, CanvasProps } from '@/src/lib/canvas/types'
import {
  type CanvasSize,
  shadowToCss,
  sizeToCss,
} from '@/src/lib/canvas/values'
import { SITE_ELEMENT_TYPES, SITE_TYPES } from './constants'
import { type SiteRenderContext, siteLink } from './context'
import { SITE_LINK_TARGETS } from './inspector'
import type { SiteAnimation, SiteHover, SiteInteraction } from './schemas'
import type { SiteDecls, SiteRuleSet } from './styles'

/**
 * Cross-cutting behaviour of the site elements (phase S2): click
 * interactions, entrance animations, hover/focus styles and the position
 * inside a container in free positioning. Styles compile into the node's
 * class like any other prop; behaviour becomes `data-s-*` attributes and
 * classes read by the small runtime scripts (`runtime/`), so a page only
 * ships the scripts it uses. Nothing here runs in the editor canvas.
 */

// ─── which types get what ─────────────────────────────────────────────────

/** Where the hover style applies inside the element (selector suffix). */
export const HOVER_TARGETS: Record<string, string> = {
  [SITE_TYPES.button]: ' .s-btn',
  [SITE_TYPES.image]: ' img',
  [SITE_TYPES.icon]: ' .s-icon-box',
  [SITE_TYPES.container]: '',
  [SITE_TYPES.slide]: '',
}

/** Types without interactions/animations (structure, not content). */
const NO_EFFECTS = new Set<string>([
  SITE_TYPES.page,
  SITE_TYPES.columns,
  SITE_TYPES.spacer,
  SITE_TYPES.popup,
  SITE_TYPES.slide,
  SITE_TYPES.tab,
  SITE_TYPES.accordionItem,
])

export function hasEffects(type: string): boolean {
  return !NO_EFFECTS.has(type)
}

// ─── compiled styles ──────────────────────────────────────────────────────

const EASINGS: Record<string, string> = {
  ease: 'ease',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  linear: 'linear',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
}

function hoverDecls(hover: SiteHover): SiteDecls {
  const transforms: string[] = []
  if (hover.lift) transforms.push(`translateY(${-hover.lift}px)`)
  if (hover.scale !== undefined && hover.scale !== 100) {
    transforms.push(`scale(${hover.scale / 100})`)
  }
  return {
    'background-color': colorOf(hover.background),
    color: colorOf(hover.textColor),
    'border-color': colorOf(hover.borderColor),
    'box-shadow': shadowToCss(hover.shadow),
    transform: transforms.length ? transforms.join(' ') : undefined,
    opacity: hover.opacity === undefined ? undefined : hover.opacity / 100,
  }
}

function colorOf(value: string | undefined) {
  if (!value) return undefined
  return value.startsWith('token:')
    ? `var(--canvas-${value.slice('token:'.length)})`
    : value
}

/** Rules the effects add to a node's class (props resolved for one
 * breakpoint). Merged by the compiler after the type's own rules. */
export function effectRules(type: string, props: CanvasProps): SiteRuleSet {
  const rules: SiteRuleSet = {}
  const own: SiteDecls = {}
  const place = props.place as
    | { x: number; y: number; width?: CanvasSize; z?: number }
    | undefined
  if (place) {
    own['--s-x'] = `${place.x}px`
    own['--s-y'] = `${place.y}px`
    own['--s-w'] = sizeToCss(place.width)
    own['--s-z'] = place.z
  }
  const animation = props.animation as SiteAnimation | undefined
  if (animation && animation.effect !== 'none' && hasEffects(type)) {
    own['animation-duration'] = `${animation.duration ?? 600}ms`
    own['animation-delay'] = animation.delay
      ? `${animation.delay}ms`
      : undefined
    own['animation-timing-function'] = EASINGS[animation.easing ?? 'ease-out']
  }
  if (Object.keys(own).length) rules[''] = own

  const hover = props.hover as SiteHover | undefined
  const target = HOVER_TARGETS[type]
  if (hover && target !== undefined) {
    const decls = hoverDecls(hover)
    if (Object.values(decls).some((value) => value !== undefined)) {
      const ms = hover.duration ?? 200
      rules[target] = {
        ...rules[target],
        transition: `background-color ${ms}ms,color ${ms}ms,border-color ${ms}ms,box-shadow ${ms}ms,transform ${ms}ms,opacity ${ms}ms`,
      }
      rules[`${target}:hover`] = decls
      rules[target === '' ? ':focus-within' : `${target}:focus-visible`] = decls
    }
  }
  return rules
}

// ─── render: attributes and classes ───────────────────────────────────────

/** Behaviour of a node on the published page (nothing while editing). */
export function effectAttributes(
  node: CanvasNode,
  ctx: SiteRenderContext,
): { className?: string; attrs: Record<string, string | number> } {
  const attrs: Record<string, string | number> = {}
  const classes: string[] = []
  if (!hasEffects(node.type)) return { attrs }

  const animation = node.props.animation as SiteAnimation | undefined
  if (animation && animation.effect !== 'none') {
    classes.push('s-anim', `s-anim-${animation.effect}`)
    if ((animation.trigger ?? 'scroll') === 'scroll') classes.push('s-reveal')
  }

  const interaction = node.props.interaction as SiteInteraction | undefined
  if (interaction && interaction.action !== 'none') {
    const { action, target } = interaction
    if (action === 'link') {
      const link = siteLink(interaction.link, ctx)
      if (link.href) {
        attrs['data-s-action'] = 'link'
        attrs['data-s-href'] = link.href
        if (link.target) attrs['data-s-blank'] = ''
      }
    } else if (action === 'close' || target) {
      attrs['data-s-action'] = action
      if (target) attrs['data-s-target'] = target
    }
  }
  return {
    className: classes.length ? classes.join(' ') : undefined,
    attrs,
  }
}

/** Elements that are already interactive on their own. */
const INTERACTIVE_TAGS = new Set(['a', 'button', 'summary', 'details'])

/**
 * Adds a node's effect classes and attributes to the element its
 * component rendered. A clickable element that is not interactive by
 * itself becomes a keyboard-reachable button/link.
 */
export function decorate(
  element: ReactNode,
  node: CanvasNode,
  ctx: SiteRenderContext,
): ReactNode {
  if (!isValidElement(element)) return element
  const { className, attrs } = effectAttributes(node, ctx)
  if (!className && Object.keys(attrs).length === 0) return element
  const props = (element as ReactElement<Record<string, unknown>>).props
  const extra: Record<string, unknown> = { ...attrs }
  if (className) {
    extra.className = [props.className, className].filter(Boolean).join(' ')
  }
  const action = attrs['data-s-action']
  if (
    action &&
    typeof element.type === 'string' &&
    !INTERACTIVE_TAGS.has(element.type) &&
    node.type !== SITE_TYPES.button
  ) {
    extra.role = action === 'link' ? 'link' : 'button'
    extra.tabIndex = 0
  }
  return cloneElement(element, extra)
}

/** Wraps a definition's render with `decorate` (final output only). */
export function withEffects<P extends CanvasProps>(
  render: (props: CanvasRenderProps<P>) => ReactNode,
  ctx: SiteRenderContext,
) {
  return (props: CanvasRenderProps<P>): ReactNode => {
    const element = render(props)
    return props.editing
      ? element
      : decorate(element, props.node as CanvasNode, ctx)
  }
}

// ─── inspector ────────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'popup', label: 'Abrir popup' },
  { value: 'close', label: 'Fechar popup' },
  { value: 'scroll', label: 'Rolar até uma seção' },
  { value: 'link', label: 'Ir para página ou link' },
  { value: 'toggle', label: 'Mostrar/ocultar elemento' },
]

const EFFECT_OPTIONS = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'fade', label: 'Aparecer' },
  { value: 'fade-up', label: 'Subir' },
  { value: 'fade-down', label: 'Descer' },
  { value: 'slide-left', label: 'Entrar pela direita' },
  { value: 'slide-right', label: 'Entrar pela esquerda' },
  { value: 'zoom', label: 'Aproximar' },
  { value: 'blur', label: 'Desfocar' },
]

const action = (props: CanvasProps) =>
  (props.interaction as SiteInteraction | undefined)?.action ?? 'none'
const animated = (props: CanvasProps) =>
  ((props.animation as SiteAnimation | undefined)?.effect ?? 'none') !== 'none'

function targetField(
  picker: ComponentType<CustomControlProps> | undefined,
): InspectorField {
  return {
    path: 'interaction.target',
    label: 'Destino',
    help: 'A âncora do popup, da seção ou do elemento (defina em Avançado › Âncora).',
    showIf: (props) => ['popup', 'scroll', 'toggle'].includes(action(props)),
    control: picker
      ? { kind: 'custom', component: picker }
      : { kind: 'text', placeholder: 'oferta', maxLength: 60 },
  }
}

export function interactionSection(ctx: SiteRenderContext): InspectorSection {
  return {
    id: 'interaction',
    label: 'Ao clicar',
    tab: 'advanced',
    fields: [
      {
        path: 'interaction.action',
        label: 'Ação',
        control: { kind: 'select', options: ACTION_OPTIONS },
      },
      targetField(ctx.anchorPicker),
      {
        path: 'interaction.link',
        label: 'Link',
        showIf: (props) => action(props) === 'link',
        control: { kind: 'link', targets: SITE_LINK_TARGETS },
      },
    ],
  }
}

export const animationSection: InspectorSection = {
  id: 'animation',
  label: 'Animação de entrada',
  tab: 'advanced',
  collapsed: true,
  fields: [
    {
      path: 'animation.effect',
      label: 'Efeito',
      help: 'Quem pede menos movimento no sistema vê o elemento sem animação.',
      control: { kind: 'select', options: EFFECT_OPTIONS },
    },
    {
      path: 'animation.trigger',
      label: 'Quando',
      showIf: animated,
      control: {
        kind: 'segmented',
        options: [
          { value: 'scroll', label: 'Ao aparecer' },
          { value: 'load', label: 'Ao abrir' },
        ],
      },
    },
    {
      path: 'animation.duration',
      label: 'Duração',
      showIf: animated,
      control: { kind: 'number', min: 100, max: 5000, step: 50, unit: 'ms' },
    },
    {
      path: 'animation.delay',
      label: 'Atraso',
      showIf: animated,
      control: { kind: 'number', min: 0, max: 10000, step: 50, unit: 'ms' },
    },
    {
      path: 'animation.easing',
      label: 'Aceleração',
      showIf: animated,
      control: {
        kind: 'select',
        options: [
          { value: 'ease-out', label: 'Suave no fim' },
          { value: 'ease', label: 'Suave' },
          { value: 'ease-in-out', label: 'Suave nas pontas' },
          { value: 'linear', label: 'Constante' },
          { value: 'spring', label: 'Mola' },
        ],
      },
    },
  ],
}

export const hoverSection: InspectorSection = {
  id: 'hover',
  label: 'Ao passar o mouse',
  tab: 'style',
  collapsed: true,
  fields: [
    {
      path: 'hover.background',
      label: 'Cor de fundo',
      control: { kind: 'color', allowTokens: true, allowTransparent: true },
    },
    {
      path: 'hover.textColor',
      label: 'Cor do texto',
      control: { kind: 'color', allowTokens: true },
    },
    {
      path: 'hover.borderColor',
      label: 'Cor da borda',
      control: { kind: 'color', allowTokens: true, allowTransparent: true },
    },
    { path: 'hover.shadow', label: 'Sombra', control: { kind: 'shadow' } },
    {
      path: 'hover.scale',
      label: 'Escala',
      help: '100% mantém o tamanho.',
      control: { kind: 'number', min: 50, max: 200, unit: '%' },
    },
    {
      path: 'hover.lift',
      label: 'Elevar',
      control: { kind: 'number', min: -60, max: 60, unit: 'px' },
    },
    {
      path: 'hover.opacity',
      label: 'Opacidade',
      control: { kind: 'number', min: 0, max: 100, unit: '%' },
    },
    {
      path: 'hover.duration',
      label: 'Transição',
      control: { kind: 'number', min: 0, max: 2000, step: 50, unit: 'ms' },
    },
  ],
}

export const placeSection: InspectorSection = {
  id: 'place',
  label: 'Posição livre',
  tab: 'advanced',
  collapsed: true,
  fields: [
    {
      path: 'place.x',
      label: 'Horizontal (X)',
      help: 'Vale dentro de um container em posição livre. Arraste o elemento no canvas para posicionar.',
      responsive: true,
      control: { kind: 'number', min: -4000, max: 4000, unit: 'px' },
    },
    {
      path: 'place.y',
      label: 'Vertical (Y)',
      responsive: true,
      control: { kind: 'number', min: -4000, max: 4000, unit: 'px' },
    },
    {
      path: 'place.width',
      label: 'Largura',
      responsive: true,
      control: { kind: 'size', units: ['auto', 'px', '%'] },
    },
    {
      path: 'place.z',
      label: 'Camada',
      help: 'Números maiores ficam na frente.',
      control: { kind: 'number', min: 0, max: 100 },
    },
  ],
}

/** Inspector sections the effects add to a type. */
export function effectSections(
  type: string,
  ctx: SiteRenderContext,
): InspectorSection[] {
  const sections: InspectorSection[] = []
  if (HOVER_TARGETS[type] !== undefined) sections.push(hoverSection)
  if (hasEffects(type)) {
    sections.push(interactionSection(ctx), animationSection)
  }
  if (type === SITE_TYPES.container || SITE_ELEMENT_TYPES.includes(type)) {
    sections.push(placeSection)
  }
  return sections
}
