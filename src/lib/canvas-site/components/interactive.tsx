import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  PauseIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { Children, type MouseEvent, type ReactNode } from 'react'
import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorSection,
} from '@/src/lib/canvas/registry'
import type { CanvasFragment, CanvasNode } from '@/src/lib/canvas/types'
import { spacing } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '../constants'
import { classNames } from '../css'
import { IconSvg, SITE_ICONS } from '../icons'
import {
  ASPECT_RATIO_LABELS,
  advancedSection,
  ICON_OPTIONS,
  presetOptions,
  spacingSection,
} from '../inspector'
import { safeSrc } from '../sanitize'
import {
  ASPECT_RATIOS,
  type SiteAccordionItemProps,
  type SiteAccordionProps,
  type SiteBeforeAfterProps,
  type SiteCarouselProps,
  type SitePopupProps,
  type SiteSlideProps,
  type SiteTabProps,
  type SiteTabsProps,
  siteAccordionItemSchema,
  siteAccordionSchema,
  siteBeforeAfterSchema,
  siteCarouselSchema,
  sitePopupSchema,
  siteSlideSchema,
  siteTabSchema,
  siteTabsSchema,
} from '../schemas'
import { CHILD_TYPES, EmptySlot } from './layout'

/**
 * Interactive elements of the site catalog (phase S2): carousel + slides,
 * tabs, accordion, popup and before/after. They render complete, semantic
 * HTML that works (or degrades to readable content) without JavaScript;
 * the published page adds one small script per element type (`runtime/`).
 * In the editor they show the child being edited (`activeChild`).
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

/** Only the visibility toggles (children whose id is generated). */
const visibilitySection: InspectorSection = {
  ...advancedSection,
  label: 'Visibilidade',
  fields: advancedSection.fields.filter((field) => field.path === 'visibility'),
}

/** Children of `node`, in order, with the rendered elements. */
function pairChildren(
  node: CanvasNode,
  childNodes: CanvasNode[] | undefined,
  children: ReactNode,
): Array<{ child: CanvasNode; element: ReactNode }> {
  const elements = Children.toArray(children)
  const ids = node.children ?? []
  return (childNodes ?? [])
    .filter((child) => !child.meta?.hidden)
    .map((child) => ({ child, element: elements[ids.indexOf(child.id)] }))
}

function indexOfActive(
  ids: string[],
  activeChild: string | null | undefined,
): number {
  const index = activeChild ? ids.indexOf(activeChild) : -1
  return index < 0 ? 0 : index
}

// ─── carousel controls (carousel, testimonials) ───────────────────────────

/**
 * Arrows, dots and the pause button of a carousel. Hidden without
 * JavaScript (the track still scrolls and swipes). In the editor the dots
 * and arrows carry the slide ids, so clicking them selects that slide.
 */
export function CarouselControls({
  count,
  active = 0,
  arrows,
  dots,
  autoplay,
  slideIds,
}: {
  count: number
  active?: number
  arrows: boolean
  dots: boolean
  autoplay: boolean
  /** Editor: the slide node ids (dots and arrows select them). */
  slideIds?: string[]
}) {
  if (count < 2 || (!arrows && !dots && !autoplay)) return null
  const select = (index: number) =>
    slideIds?.[index] ? { 'data-canvas-id': slideIds[index] } : {}
  return (
    <div className='s-carousel-controls'>
      {arrows && (
        <button
          type='button'
          className='s-carousel-btn'
          data-s-prev=''
          aria-label='Slide anterior'
          {...select(active - 1)}
        >
          <IconSvg icon={ArrowLeft01Icon} />
        </button>
      )}
      {dots && (
        <div className='s-carousel-dots'>
          {Array.from({ length: count }, (_, index) => (
            <button
              key={index}
              type='button'
              className='s-carousel-dot'
              data-s-dot={index}
              aria-label={`Ir para o slide ${index + 1}`}
              aria-current={index === active ? 'true' : undefined}
              {...select(index)}
            />
          ))}
        </div>
      )}
      {arrows && (
        <button
          type='button'
          className='s-carousel-btn'
          data-s-next=''
          aria-label='Próximo slide'
          {...select(active + 1)}
        >
          <IconSvg icon={ArrowRight01Icon} />
        </button>
      )}
      {autoplay && !slideIds && (
        <button
          type='button'
          className='s-carousel-btn'
          data-s-pause=''
          aria-label='Pausar a passagem automática'
        >
          <IconSvg icon={PauseIcon} />
        </button>
      )}
    </div>
  )
}

/** Attributes the carousel script reads (final output only). */
export function carouselData(
  editing: boolean,
  autoplay: boolean,
  interval: number,
  loop: boolean,
) {
  if (editing) return {}
  return {
    'data-s-carousel': '',
    'data-autoplay': autoplay ? interval : undefined,
    'data-loop': loop ? '' : undefined,
  }
}

// ─── carousel ─────────────────────────────────────────────────────────────

export function defaultSlideProps(
  overrides: Partial<SiteSlideProps> = {},
): SiteSlideProps {
  return {
    background: { kind: 'color', color: 'token:surface' },
    padding: { base: spacing(48, 40), mobile: spacing(32, 20) },
    gap: 16,
    alignItems: 'stretch',
    verticalAlign: 'center',
    minHeight: { value: 320, unit: 'px' },
    ...overrides,
  }
}

/** A carousel with `count` slides, each with a heading and a text. */
export function carouselFragment(count = 3): CanvasFragment {
  const nodes: CanvasFragment['nodes'] = {
    carousel: {
      id: 'carousel',
      type: SITE_TYPES.carousel,
      props: defaultCarouselProps(),
      children: [],
    },
  }
  for (let i = 0; i < count; i++) {
    const slide = `slide-${i}`
    nodes[slide] = {
      id: slide,
      type: SITE_TYPES.slide,
      props: defaultSlideProps(),
      children: [`${slide}-h`, `${slide}-t`],
    }
    nodes[`${slide}-h`] = {
      id: `${slide}-h`,
      type: SITE_TYPES.heading,
      props: { text: `Slide ${i + 1}`, level: 'h3', align: 'left' },
    }
    nodes[`${slide}-t`] = {
      id: `${slide}-t`,
      type: SITE_TYPES.text,
      props: {
        html: '<p>Arraste imagens, textos e botões para este slide.</p>',
        preset: 'body',
        align: 'left',
      },
    }
    nodes.carousel.children?.push(slide)
  }
  return { rootId: 'carousel', nodes }
}

function defaultCarouselProps(): SiteCarouselProps {
  return {
    label: 'Destaques',
    autoplay: false,
    interval: 6,
    loop: true,
    arrows: true,
    dots: true,
    perView: 1,
    gap: 24,
  }
}

export const carouselDefinition = defineComponent<SiteCarouselProps>({
  type: SITE_TYPES.carousel,
  label: 'Carrossel',
  icon: 'carousel',
  category: 'Interativos',
  keywords: ['slider', 'slides', 'banner rotativo', 'galeria', 'carrossel'],
  propsSchema: siteCarouselSchema,
  defaultProps: defaultCarouselProps,
  accepts: [SITE_TYPES.slide],
  minChildren: 1,
  tracksSelection: true,
  template: () => carouselFragment(3),
  inspector: [
    {
      id: 'content',
      label: 'Carrossel',
      tab: 'content',
      fields: [
        {
          path: 'label',
          label: 'Nome (acessibilidade)',
          help: 'Lido por leitores de tela, ex.: "Destaques".',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'perView',
          label: 'Slides visíveis',
          responsive: true,
          control: { kind: 'number', min: 1, max: 6 },
        },
        {
          path: 'gap',
          label: 'Espaço entre slides',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
        { path: 'arrows', label: 'Setas', control: { kind: 'toggle' } },
        { path: 'dots', label: 'Indicadores', control: { kind: 'toggle' } },
        {
          path: 'loop',
          label: 'Voltar ao início',
          control: { kind: 'toggle' },
        },
        {
          path: 'autoplay',
          label: 'Passar sozinho',
          help: 'Pausa quando o visitante interage; quem pede menos movimento no sistema não vê a passagem automática.',
          control: { kind: 'toggle' },
        },
        {
          path: 'interval',
          label: 'Tempo por slide',
          showIf: { path: 'autoplay', equals: true },
          control: { kind: 'number', min: 2, max: 30, unit: 's' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Controles',
      tab: 'style',
      fields: [
        {
          path: 'controlColor',
          label: 'Cor das setas e do indicador',
          control: { kind: 'color', allowTokens: true },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
    activeChild,
  }: CanvasRenderProps<SiteCarouselProps>) => {
    const p = node.props
    const ids = node.children ?? []
    const active = editing ? indexOfActive(ids, activeChild) : 0
    const slides = Children.toArray(children)
    return (
      <section
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-carousel')}
        aria-roledescription='carrossel'
        aria-label={p.label || 'Carrossel'}
        {...carouselData(editing, p.autoplay, p.interval, p.loop)}
      >
        <div className='s-carousel-track'>
          {editing ? slides.slice(active) : slides}
        </div>
        {editing && ids.length === 0 && (
          <EmptySlot label='Adicione slides pelo painel de Camadas' />
        )}
        <CarouselControls
          count={ids.length}
          active={active}
          arrows={p.arrows}
          dots={p.dots}
          autoplay={p.autoplay}
          slideIds={editing ? ids : undefined}
        />
      </section>
    )
  },
})

export const slideDefinition = defineComponent<SiteSlideProps>({
  type: SITE_TYPES.slide,
  label: 'Slide',
  icon: 'slide',
  propsSchema: siteSlideSchema,
  defaultProps: () => defaultSlideProps(),
  accepts: CHILD_TYPES,
  parents: [SITE_TYPES.carousel],
  inspector: [
    {
      id: 'layout',
      label: 'Conteúdo do slide',
      tab: 'content',
      fields: [
        {
          path: 'alignItems',
          label: 'Alinhar itens',
          responsive: true,
          control: {
            kind: 'segmented',
            options: [
              { value: 'stretch', label: 'Esticar' },
              { value: 'start', label: 'Início', icon: 'align-left' },
              { value: 'center', label: 'Centro', icon: 'align-center' },
              { value: 'end', label: 'Fim', icon: 'align-right' },
            ],
          },
        },
        {
          path: 'verticalAlign',
          label: 'Alinhamento vertical',
          control: {
            kind: 'segmented',
            options: [
              { value: 'start', label: 'Topo', icon: 'align-top' },
              { value: 'center', label: 'Meio', icon: 'align-middle' },
              { value: 'end', label: 'Base', icon: 'align-bottom' },
            ],
          },
        },
        {
          path: 'gap',
          label: 'Espaço entre elementos',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Fundo e tamanho',
      tab: 'style',
      fields: [
        { path: 'background', label: 'Fundo', control: { kind: 'background' } },
        {
          path: 'textColor',
          label: 'Cor do texto',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', max: 400 },
        },
        {
          path: 'minHeight',
          label: 'Altura mínima',
          responsive: true,
          control: { kind: 'size', units: ['auto', 'px', 'vh'] },
        },
        { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
      ],
    },
    visibilitySection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
  }: CanvasRenderProps<SiteSlideProps>) => (
    <div {...attributes} className={classNames(node, 's-slide')}>
      {children}
      {editing && !node.children?.length && (
        <EmptySlot label='Arraste elementos para este slide' />
      )}
    </div>
  ),
})

// ─── tabs ─────────────────────────────────────────────────────────────────

export function tabsFragment(labels = ['Visão geral', 'Recursos', 'Planos']) {
  const nodes: CanvasFragment['nodes'] = {
    tabs: {
      id: 'tabs',
      type: SITE_TYPES.tabs,
      props: defaultTabsProps(),
      children: [],
    },
  }
  labels.forEach((label, i) => {
    const tab = `tab-${i}`
    nodes[tab] = {
      id: tab,
      type: SITE_TYPES.tab,
      props: { label, padding: spacing(24, 0), gap: 16 },
      children: [`${tab}-t`],
    }
    nodes[`${tab}-t`] = {
      id: `${tab}-t`,
      type: SITE_TYPES.text,
      props: {
        html: `<p>Conteúdo da aba ${label}. Arraste elementos para cá.</p>`,
        preset: 'body',
        align: 'left',
      },
    }
    nodes.tabs.children?.push(tab)
  })
  return { rootId: 'tabs', nodes }
}

function defaultTabsProps(): SiteTabsProps {
  return {
    variant: 'underline',
    orientation: 'horizontal',
    align: 'start',
    gap: 8,
  }
}

export const tabsDefinition = defineComponent<SiteTabsProps>({
  type: SITE_TYPES.tabs,
  label: 'Abas',
  icon: 'tabs',
  category: 'Interativos',
  keywords: ['tabs', 'guias', 'abas', 'alternar conteúdo'],
  propsSchema: siteTabsSchema,
  defaultProps: defaultTabsProps,
  accepts: [SITE_TYPES.tab],
  minChildren: 1,
  tracksSelection: true,
  readsChildren: true,
  template: () => tabsFragment(),
  inspector: [
    {
      id: 'style',
      label: 'Abas',
      tab: 'style',
      fields: [
        {
          path: 'variant',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'underline', label: 'Sublinhado' },
              { value: 'pills', label: 'Pílulas' },
              { value: 'boxed', label: 'Caixa' },
            ],
          },
        },
        {
          path: 'orientation',
          label: 'Posição das abas',
          control: {
            kind: 'segmented',
            options: [
              { value: 'horizontal', label: 'Em cima' },
              { value: 'vertical', label: 'Ao lado' },
            ],
          },
        },
        {
          path: 'align',
          label: 'Alinhar abas',
          control: {
            kind: 'segmented',
            options: [
              { value: 'start', label: 'Início' },
              { value: 'center', label: 'Centro' },
              { value: 'stretch', label: 'Largura total' },
            ],
          },
        },
        {
          path: 'activeColor',
          label: 'Cor da aba ativa',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'tabColor',
          label: 'Cor das outras abas',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'gap',
          label: 'Espaço entre abas e conteúdo',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
    activeChild,
    childNodes,
  }: CanvasRenderProps<SiteTabsProps>) => {
    const p = node.props
    const tabs = pairChildren(node, childNodes, children)
    const active = editing
      ? indexOfActive(
          tabs.map(({ child }) => child.id),
          activeChild,
        )
      : 0
    const vertical = p.orientation === 'vertical'
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(
          node,
          's-tabs',
          `s-tabs-${p.variant}`,
          vertical && 's-tabs-vertical',
        )}
        data-s-tabs={editing ? undefined : ''}
      >
        <div
          className='s-tablist'
          role='tablist'
          aria-orientation={vertical ? 'vertical' : undefined}
        >
          {tabs.map(({ child }, index) => {
            const tab = child.props as SiteTabProps
            return (
              <button
                key={child.id}
                type='button'
                role='tab'
                id={`tab-${child.id}`}
                aria-controls={`panel-${child.id}`}
                aria-selected={index === active}
                tabIndex={index === active ? 0 : -1}
                className='s-tab-btn'
                data-canvas-id={editing ? child.id : undefined}
              >
                {tab.icon && <IconSvg icon={SITE_ICONS[tab.icon].svg} />}
                {tab.label || `Aba ${index + 1}`}
              </button>
            )
          })}
        </div>
        <div className='s-tabpanels'>
          {editing ? tabs[active]?.element : tabs.map(({ element }) => element)}
        </div>
        {editing && tabs.length === 0 && (
          <EmptySlot label='Adicione abas pelo painel de Camadas' />
        )}
      </div>
    )
  },
})

export const tabDefinition = defineComponent<SiteTabProps>({
  type: SITE_TYPES.tab,
  label: 'Aba',
  icon: 'tab',
  propsSchema: siteTabSchema,
  defaultProps: () => ({ label: 'Nova aba', padding: spacing(24, 0), gap: 16 }),
  accepts: CHILD_TYPES,
  parents: [SITE_TYPES.tabs],
  inspector: [
    {
      id: 'content',
      label: 'Aba',
      tab: 'content',
      fields: [
        {
          path: 'label',
          label: 'Título da aba',
          control: { kind: 'text', maxLength: 80 },
        },
        {
          path: 'icon',
          label: 'Ícone',
          control: {
            kind: 'select',
            options: [{ value: '', label: 'Sem ícone' }, ...ICON_OPTIONS],
          },
        },
        {
          path: 'gap',
          label: 'Espaço entre elementos',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', max: 400 },
        },
      ],
    },
    visibilitySection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
  }: CanvasRenderProps<SiteTabProps>) => (
    <div
      {...attributes}
      id={`panel-${node.id}`}
      role='tabpanel'
      aria-labelledby={`tab-${node.id}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs pattern (panel without focusable content)
      tabIndex={0}
      className={classNames(node, 's-tabpanel')}
    >
      {children}
      {editing && !node.children?.length && (
        <EmptySlot label='Arraste elementos para esta aba' />
      )}
    </div>
  ),
})

// ─── accordion ────────────────────────────────────────────────────────────

const QUESTIONS: Array<[string, string]> = [
  [
    'Como funciona o atendimento?',
    'Você fala com pessoas de verdade por WhatsApp, e-mail e telefone, em horário comercial.',
  ],
  [
    'Posso cancelar quando quiser?',
    'Sim. Não há fidelidade: cancele pelo painel e não pague o mês seguinte.',
  ],
  [
    'Vocês atendem todo o Brasil?',
    'Sim, trabalhamos de forma remota com reuniões por vídeo.',
  ],
]

export function accordionFragment(
  items: Array<[string, string]> = QUESTIONS,
): CanvasFragment {
  const nodes: CanvasFragment['nodes'] = {
    accordion: {
      id: 'accordion',
      type: SITE_TYPES.accordion,
      props: defaultAccordionProps(),
      children: [],
    },
  }
  items.forEach(([title, answer], i) => {
    const item = `item-${i}`
    nodes[item] = {
      id: item,
      type: SITE_TYPES.accordionItem,
      props: { title, open: i === 0, gap: 12 },
      children: [`${item}-t`],
    }
    nodes[`${item}-t`] = {
      id: `${item}-t`,
      type: SITE_TYPES.text,
      props: {
        html: `<p>${answer}</p>`,
        preset: 'body',
        align: 'left',
        color: 'token:muted',
      },
    }
    nodes.accordion.children?.push(item)
  })
  return { rootId: 'accordion', nodes }
}

function defaultAccordionProps(): SiteAccordionProps {
  return {
    multiple: false,
    variant: 'separated',
    icon: 'chevron',
    headingLevel: 'h3',
    titlePreset: 'h6',
    gap: 12,
  }
}

const stopToggle = (event: MouseEvent) => event.preventDefault()

export const accordionDefinition = defineComponent<SiteAccordionProps>({
  type: SITE_TYPES.accordion,
  label: 'Acordeão (FAQ)',
  icon: 'accordion',
  category: 'Interativos',
  keywords: ['faq', 'perguntas', 'sanfona', 'expandir', 'dúvidas'],
  propsSchema: siteAccordionSchema,
  defaultProps: defaultAccordionProps,
  accepts: [SITE_TYPES.accordionItem],
  minChildren: 1,
  tracksSelection: true,
  readsChildren: true,
  template: () => accordionFragment(),
  inspector: [
    {
      id: 'content',
      label: 'Acordeão',
      tab: 'content',
      fields: [
        {
          path: 'multiple',
          label: 'Vários abertos ao mesmo tempo',
          control: { kind: 'toggle' },
        },
        {
          path: 'headingLevel',
          label: 'Nível dos títulos (SEO)',
          control: {
            kind: 'segmented',
            options: ['h2', 'h3', 'h4', 'h5', 'h6'].map((level) => ({
              value: level,
              label: level.toUpperCase(),
            })),
          },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'variant',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'separated', label: 'Cartões' },
              { value: 'bordered', label: 'Bloco' },
              { value: 'minimal', label: 'Linhas' },
            ],
          },
        },
        {
          path: 'icon',
          label: 'Ícone',
          control: {
            kind: 'segmented',
            options: [
              { value: 'chevron', label: 'Seta' },
              { value: 'plus', label: 'Mais' },
            ],
          },
        },
        {
          path: 'titlePreset',
          label: 'Estilo dos títulos',
          control: {
            kind: 'select',
            options: presetOptions(['h4', 'h5', 'h6', 'lead', 'body']),
          },
        },
        {
          path: 'itemBackground',
          label: 'Fundo dos itens',
          control: { kind: 'color', allowTokens: true, allowTransparent: true },
        },
        {
          path: 'borderColor',
          label: 'Cor das bordas',
          control: { kind: 'color', allowTokens: true },
        },
        { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
        {
          path: 'gap',
          label: 'Espaço entre itens',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
    activeChild,
    childNodes,
  }: CanvasRenderProps<SiteAccordionProps>) => {
    const p = node.props
    const Heading = p.headingLevel
    const group = p.multiple ? undefined : `acc-${node.id}`
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(
          node,
          's-accordion',
          `s-acc-${p.variant}`,
          p.icon === 'plus' && 's-acc-plus',
        )}
      >
        {pairChildren(node, childNodes, children).map(({ child, element }) => {
          const item = child.props as SiteAccordionItemProps
          return (
            <details
              key={child.id}
              id={anchorId(item.anchor)}
              className={classNames(child, 's-acc-item')}
              name={group}
              open={item.open || (editing && child.id === activeChild)}
              data-canvas-id={editing ? child.id : undefined}
            >
              <summary
                className='s-acc-summary'
                onClick={editing ? stopToggle : undefined}
              >
                <Heading className={`s-acc-title s-t-${p.titlePreset}`}>
                  {item.title || 'Pergunta'}
                </Heading>
                <IconSvg
                  icon={p.icon === 'plus' ? Add01Icon : ArrowDown01Icon}
                  className='s-acc-icon'
                />
              </summary>
              {element}
            </details>
          )
        })}
        {editing && !node.children?.length && (
          <EmptySlot label='Adicione itens pelo painel de Camadas' />
        )}
      </div>
    )
  },
})

export const accordionItemDefinition = defineComponent<SiteAccordionItemProps>({
  type: SITE_TYPES.accordionItem,
  label: 'Item do acordeão',
  icon: 'accordionItem',
  propsSchema: siteAccordionItemSchema,
  defaultProps: () => ({ title: 'Nova pergunta', open: false, gap: 12 }),
  accepts: CHILD_TYPES,
  parents: [SITE_TYPES.accordion],
  inspector: [
    {
      id: 'content',
      label: 'Item',
      tab: 'content',
      fields: [
        {
          path: 'title',
          label: 'Título',
          control: { kind: 'textarea', rows: 2, maxLength: 300 },
        },
        {
          path: 'open',
          label: 'Começa aberto',
          control: { kind: 'toggle' },
        },
        {
          path: 'gap',
          label: 'Espaço entre elementos',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ],
    },
    advancedSection,
  ],
  // The accordion draws the <details>/<summary> around it (title, group,
  // heading level) and carries this node's class and canvas id.
  render: ({
    node,
    children,
    editing,
  }: CanvasRenderProps<SiteAccordionItemProps>) => (
    <div className='s-acc-body'>
      {children}
      {editing && !node.children?.length && (
        <EmptySlot label='Arraste a resposta para cá' />
      )}
    </div>
  ),
})

// ─── popup ────────────────────────────────────────────────────────────────

export function popupFragment(): CanvasFragment {
  return {
    rootId: 'popup',
    nodes: {
      popup: {
        id: 'popup',
        type: SITE_TYPES.popup,
        props: defaultPopupProps(),
        children: ['h', 't', 'b'],
      },
      h: {
        id: 'h',
        type: SITE_TYPES.heading,
        props: {
          text: 'Ganhe 10% na primeira compra',
          level: 'h2',
          align: 'center',
          preset: 'h3',
        },
      },
      t: {
        id: 't',
        type: SITE_TYPES.text,
        props: {
          html: '<p>Deixe seu e-mail e receba o cupom agora mesmo.</p>',
          preset: 'body',
          align: 'center',
          color: 'token:muted',
        },
      },
      b: {
        id: 'b',
        type: SITE_TYPES.button,
        props: {
          label: 'Quero o cupom',
          link: { type: 'anchor', value: 'contato' },
          variant: 'primary',
          size: 'md',
          align: 'stretch',
          iconPosition: 'end',
          interaction: { action: 'close' },
        },
      },
    },
  }
}

function defaultPopupProps(): SitePopupProps {
  return {
    name: 'Oferta',
    trigger: 'click',
    delay: 5,
    scrollPercent: 50,
    frequency: 'session',
    width: 480,
    position: 'center',
    background: { kind: 'color', color: 'token:background' },
    padding: { base: spacing(40, 32), mobile: spacing(32, 20) },
    gap: 16,
    radius: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
    overlayColor: '#09090b',
    overlayOpacity: 60,
    closeOnOverlay: true,
    showClose: true,
  }
}

export const popupDefinition = defineComponent<SitePopupProps>({
  type: SITE_TYPES.popup,
  label: 'Popup',
  icon: 'popup',
  category: 'Interativos',
  keywords: ['modal', 'janela', 'oferta', 'aviso', 'lightbox', 'pop-up'],
  propsSchema: sitePopupSchema,
  defaultProps: defaultPopupProps,
  accepts: CHILD_TYPES,
  parents: [SITE_TYPES.page],
  template: popupFragment,
  inspector: [
    {
      id: 'content',
      label: 'Popup',
      tab: 'content',
      fields: [
        {
          path: 'name',
          label: 'Nome',
          help: 'Aparece no editor e é lido por leitores de tela.',
          control: { kind: 'text', maxLength: 80 },
        },
        {
          path: 'anchor',
          label: 'Âncora',
          help: 'Opcional. Botões com a ação "Abrir popup" ou links para #âncora abrem este popup.',
          control: { kind: 'text', placeholder: 'oferta', maxLength: 60 },
        },
        {
          path: 'trigger',
          label: 'Abrir',
          control: {
            kind: 'select',
            options: [
              { value: 'click', label: 'Só por um clique (botão ou link)' },
              { value: 'load', label: 'Ao abrir a página' },
              { value: 'delay', label: 'Depois de alguns segundos' },
              { value: 'scroll', label: 'Ao rolar parte da página' },
              { value: 'exit', label: 'Ao tentar sair da página' },
            ],
          },
        },
        {
          path: 'delay',
          label: 'Esperar',
          showIf: { path: 'trigger', equals: 'delay' },
          control: { kind: 'number', min: 0, max: 300, unit: 's' },
        },
        {
          path: 'scrollPercent',
          label: 'Depois de rolar',
          showIf: { path: 'trigger', equals: 'scroll' },
          control: { kind: 'number', min: 5, max: 100, unit: '%' },
        },
        {
          path: 'frequency',
          label: 'Mostrar',
          showIf: (props) => props.trigger !== 'click',
          control: {
            kind: 'select',
            options: [
              { value: 'session', label: 'Uma vez por visita' },
              { value: 'once', label: 'Só uma vez por visitante' },
              { value: 'always', label: 'Sempre' },
            ],
          },
        },
        {
          path: 'showClose',
          label: 'Botão de fechar',
          control: { kind: 'toggle' },
        },
        {
          path: 'closeOnOverlay',
          label: 'Fechar ao clicar fora',
          control: { kind: 'toggle' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Janela',
      tab: 'style',
      fields: [
        {
          path: 'position',
          label: 'Posição',
          control: {
            kind: 'select',
            options: [
              { value: 'center', label: 'Centro' },
              { value: 'top', label: 'Topo' },
              { value: 'bottom', label: 'Base' },
              { value: 'bottom-left', label: 'Canto inferior esquerdo' },
              { value: 'bottom-right', label: 'Canto inferior direito' },
            ],
          },
        },
        {
          path: 'width',
          label: 'Largura',
          responsive: true,
          control: {
            kind: 'number',
            min: 240,
            max: 1400,
            step: 10,
            unit: 'px',
          },
        },
        { path: 'background', label: 'Fundo', control: { kind: 'background' } },
        {
          path: 'textColor',
          label: 'Cor do texto',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', max: 400 },
        },
        {
          path: 'gap',
          label: 'Espaço entre elementos',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
        { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
        { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
        {
          path: 'overlayColor',
          label: 'Cor do fundo escurecido',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'overlayOpacity',
          label: 'Opacidade do fundo',
          control: { kind: 'number', min: 0, max: 100, unit: '%' },
        },
      ],
    },
    {
      ...advancedSection,
      label: 'Visibilidade',
      fields: advancedSection.fields.filter(
        (field) => field.path === 'visibility',
      ),
    },
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
  }: CanvasRenderProps<SitePopupProps>) => {
    const p = node.props
    const close = p.showClose ? (
      <button
        type='button'
        className='s-popup-close'
        data-s-close=''
        aria-label='Fechar'
        tabIndex={editing ? -1 : undefined}
      >
        <IconSvg icon={Cancel01Icon} />
      </button>
    ) : null
    const body = (
      <div className='s-popup-body'>
        {children}
        {editing && !node.children?.length && (
          <EmptySlot label='Arraste elementos para o popup' />
        )}
      </div>
    )
    if (editing) {
      return (
        <div {...attributes} className='s-popup-stage'>
          <div className={classNames(node, 's-popup', `s-popup-${p.position}`)}>
            {close}
            {body}
          </div>
        </div>
      )
    }
    return (
      <dialog
        id={p.anchor || `popup-${node.id}`}
        className={classNames(node, 's-popup', `s-popup-${p.position}`)}
        aria-label={p.name || 'Popup'}
        data-s-popup=''
        data-trigger={p.trigger}
        data-delay={p.trigger === 'delay' ? p.delay : undefined}
        data-scroll={p.trigger === 'scroll' ? p.scrollPercent : undefined}
        data-freq={p.trigger === 'click' ? undefined : p.frequency}
        data-overlay-close={p.closeOnOverlay ? '' : undefined}
      >
        {close}
        {body}
      </dialog>
    )
  },
})

// ─── before / after ───────────────────────────────────────────────────────

export const beforeAfterDefinition = defineComponent<SiteBeforeAfterProps>({
  type: SITE_TYPES.beforeAfter,
  label: 'Antes e depois',
  icon: 'beforeAfter',
  category: 'Mídia',
  keywords: ['comparar', 'comparação', 'antes depois', 'resultado'],
  propsSchema: siteBeforeAfterSchema,
  defaultProps: () => ({
    before: {
      src: '/landing-page-templates/agency/work-2.png',
      alt: 'Antes',
    },
    after: {
      src: '/landing-page-templates/agency/work-3.png',
      alt: 'Depois',
    },
    beforeLabel: 'Antes',
    afterLabel: 'Depois',
    start: 50,
    orientation: 'horizontal',
    aspectRatio: '16/9',
    handleColor: '#ffffff',
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Imagens',
      tab: 'content',
      fields: [
        { path: 'before', label: 'Antes', control: { kind: 'image' } },
        { path: 'after', label: 'Depois', control: { kind: 'image' } },
        {
          path: 'beforeLabel',
          label: 'Rótulo de antes',
          control: { kind: 'text', maxLength: 40 },
        },
        {
          path: 'afterLabel',
          label: 'Rótulo de depois',
          control: { kind: 'text', maxLength: 40 },
        },
        {
          path: 'start',
          label: 'Posição inicial',
          control: { kind: 'number', min: 0, max: 100, unit: '%' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'orientation',
          label: 'Divisão',
          control: {
            kind: 'segmented',
            options: [
              { value: 'horizontal', label: 'Lado a lado' },
              { value: 'vertical', label: 'Em cima e embaixo' },
            ],
          },
        },
        {
          path: 'aspectRatio',
          label: 'Proporção',
          control: {
            kind: 'select',
            options: ASPECT_RATIOS.map((value) => ({
              value,
              label: ASPECT_RATIO_LABELS[value],
            })),
          },
        },
        {
          path: 'handleColor',
          label: 'Cor da divisória',
          control: { kind: 'color', allowTokens: true },
        },
        { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    attributes,
    editing,
  }: CanvasRenderProps<SiteBeforeAfterProps>) => {
    const p = node.props
    const before = safeSrc(p.before.src)
    const after = safeSrc(p.after.src)
    if ((!before || !after) && !editing) return null
    if (!before || !after) {
      return (
        <div {...attributes} className={classNames(node, 's-ba')}>
          <div className='s-placeholder'>
            Escolha as imagens de antes e depois no painel à direita
          </div>
        </div>
      )
    }
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(
          node,
          's-ba',
          p.orientation === 'vertical' && 's-ba-v',
        )}
        data-s-ba={editing ? undefined : ''}
      >
        <img src={before} alt={p.before.alt} loading='lazy' decoding='async' />
        <div className='s-ba-after'>
          <img src={after} alt={p.after.alt} loading='lazy' decoding='async' />
        </div>
        <input
          type='range'
          className='s-ba-range'
          min={0}
          max={100}
          defaultValue={p.start}
          aria-label={`Comparar ${p.beforeLabel || 'antes'} e ${p.afterLabel || 'depois'}`}
          aria-orientation={
            p.orientation === 'vertical' ? 'vertical' : undefined
          }
          disabled={editing}
          tabIndex={editing ? -1 : undefined}
        />
        <span className='s-ba-handle' aria-hidden='true' />
        {p.beforeLabel && (
          <span className='s-ba-label s-ba-label-before' aria-hidden='true'>
            {p.beforeLabel}
          </span>
        )}
        {p.afterLabel && (
          <span className='s-ba-label s-ba-label-after' aria-hidden='true'>
            {p.afterLabel}
          </span>
        )}
      </div>
    )
  },
})
