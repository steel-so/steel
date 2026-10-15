import { CenterFocusIcon } from '@hugeicons-pro/core-stroke-rounded'
import { Children, type ReactNode } from 'react'
import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { resolveResponsive } from '@/src/lib/canvas/responsive'
import type { CanvasFragment, CanvasNode } from '@/src/lib/canvas/types'
import { spacing } from '@/src/lib/canvas/values'
import { SITE_ELEMENT_TYPES, SITE_TYPES } from '../constants'
import { classNames } from '../css'
import { IconSvg } from '../icons'
import { advancedSection, boxSection, marginField } from '../inspector'
import { safeSrc } from '../sanitize'
import {
  type SiteColumnsProps,
  type SiteContainerProps,
  type SitePageProps,
  type SiteSectionProps,
  siteColumnsSchema,
  siteContainerSchema,
  sitePageSchema,
  siteSectionSchema,
} from '../schemas'

export function EmptySlot({ label }: { label: string }) {
  return <div className='s-empty'>{label}</div>
}

const anchorId = (anchor: string | undefined) => anchor || undefined

// ─── page ─────────────────────────────────────────────────────────────────

export const pageDefinition = defineComponent<SitePageProps>({
  type: SITE_TYPES.page,
  label: 'Página',
  icon: 'page',
  propsSchema: sitePageSchema,
  defaultProps: () => ({ background: { kind: 'none' } }),
  accepts: [SITE_TYPES.section, SITE_TYPES.popup],
  // Popups stay folded into a chip in the canvas until one of them (or
  // something inside it) is selected.
  tracksSelection: true,
  readsChildren: true,
  inspector: [
    {
      id: 'page',
      label: 'Página',
      tab: 'style',
      fields: [
        {
          path: 'background',
          label: 'Fundo da página',
          control: { kind: 'background' },
        },
      ],
    },
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
    activeChild,
    childNodes,
  }: CanvasRenderProps<SitePageProps>) => {
    const Tag = node.props.tag ?? 'main'
    let content: ReactNode = children
    if (editing && childNodes) {
      const kids = Children.toArray(children)
      content = childNodes.map((child, index) =>
        child.type === SITE_TYPES.popup && child.id !== activeChild ? (
          <PopupChip key={child.id} node={child} />
        ) : (
          kids[index]
        ),
      )
    }
    return (
      <Tag {...attributes} className={classNames(node, 's-page')}>
        {content}
        {editing && !node.children?.length && (
          <EmptySlot label='Arraste uma Seção ou escolha uma em Seções prontas' />
        )}
      </Tag>
    )
  },
})

/** A folded popup in the canvas: clicking it selects (and opens) it. */
function PopupChip({ node }: { node: CanvasNode }) {
  const name = (node.props.name as string | undefined) || 'Popup'
  return (
    <button type='button' className='s-popup-chip' data-canvas-id={node.id}>
      <IconSvg icon={CenterFocusIcon} />
      {`Popup: ${name}`}
    </button>
  )
}

// ─── section ──────────────────────────────────────────────────────────────

export function defaultSectionProps(): SiteSectionProps {
  return {
    tag: 'section',
    background: { kind: 'none' },
    padding: { base: spacing(96, 24), mobile: spacing(64, 20) },
    width: 'boxed',
    gap: 24,
    contentAlign: 'stretch',
    verticalAlign: 'center',
  }
}

/** What sections, containers, slides, tabs, accordion items and popups
 * accept. */
export const CHILD_TYPES = [
  SITE_TYPES.container,
  SITE_TYPES.columns,
  ...SITE_ELEMENT_TYPES,
]

export const sectionDefinition = defineComponent<SiteSectionProps>({
  type: SITE_TYPES.section,
  label: 'Seção',
  icon: 'section',
  category: 'Layout',
  keywords: ['faixa', 'bloco', 'banda', 'hero', 'fundo'],
  propsSchema: siteSectionSchema,
  defaultProps: defaultSectionProps,
  accepts: CHILD_TYPES,
  parents: [SITE_TYPES.page],
  inspector: [
    {
      id: 'section',
      label: 'Seção',
      tab: 'content',
      fields: [
        {
          path: 'tag',
          label: 'Tipo (HTML)',
          help: 'Cabeçalho e rodapé ajudam leitores de tela e buscadores.',
          control: {
            kind: 'select',
            options: [
              { value: 'section', label: 'Seção' },
              { value: 'header', label: 'Cabeçalho' },
              { value: 'footer', label: 'Rodapé' },
              { value: 'main', label: 'Conteúdo principal' },
              { value: 'aside', label: 'Complementar' },
              { value: 'div', label: 'Neutro' },
            ],
          },
        },
        {
          path: 'width',
          label: 'Largura do conteúdo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'boxed', label: 'Centralizado' },
              { value: 'full', label: 'Tela cheia' },
            ],
          },
        },
        {
          path: 'maxWidth',
          label: 'Largura máxima (px)',
          responsive: true,
          showIf: { path: 'width', equals: 'boxed' },
          control: {
            kind: 'number',
            min: 240,
            max: 2400,
            step: 10,
            unit: 'px',
          },
        },
        {
          path: 'contentAlign',
          label: 'Alinhar conteúdo',
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
      id: 'background',
      label: 'Fundo',
      tab: 'style',
      fields: [
        {
          path: 'background',
          label: 'Fundo',
          control: { kind: 'background' },
        },
        {
          path: 'video.src',
          label: 'Vídeo de fundo (URL .mp4)',
          help: 'Toca sem som e em repetição atrás do conteúdo.',
          control: { kind: 'text', placeholder: 'https://…/video.mp4' },
        },
        {
          path: 'overlay.color',
          label: 'Cor da sobreposição',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'overlay.opacity',
          label: 'Opacidade da sobreposição',
          control: { kind: 'number', min: 0, max: 100, unit: '%' },
        },
        {
          path: 'textColor',
          label: 'Cor do texto',
          control: { kind: 'color', allowTokens: true },
        },
      ],
    },
    {
      id: 'spacing',
      label: 'Tamanho e espaçamento',
      tab: 'style',
      fields: [
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
        marginField,
      ],
    },
    boxSection,
    advancedSection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
  }: CanvasRenderProps<SiteSectionProps>) => {
    const p = node.props
    const Tag = p.tag
    const video = safeSrc(p.video?.src)
    return (
      <Tag
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-section')}
      >
        {video && (
          <video
            className='s-bg-video'
            src={video}
            poster={safeSrc(p.video?.poster)}
            autoPlay={!editing}
            muted
            loop
            playsInline
            preload='metadata'
            tabIndex={-1}
          />
        )}
        <div className='s-inner'>
          {children}
          {editing && !node.children?.length && (
            <EmptySlot label='Arraste elementos para esta seção' />
          )}
        </div>
      </Tag>
    )
  },
})

// ─── container ────────────────────────────────────────────────────────────

export function defaultContainerProps(
  overrides: Partial<SiteContainerProps> = {},
): SiteContainerProps {
  return {
    tag: 'div',
    layout: 'flex',
    direction: 'column',
    wrap: false,
    gap: 16,
    columns: 2,
    alignItems: 'stretch',
    justify: 'start',
    padding: spacing(0),
    background: { kind: 'none' },
    ...overrides,
  }
}

export const containerDefinition = defineComponent<SiteContainerProps>({
  type: SITE_TYPES.container,
  label: 'Container',
  icon: 'container',
  category: 'Layout',
  keywords: [
    'caixa',
    'grupo',
    'flex',
    'grid',
    'grade',
    'linha',
    'coluna',
    'card',
  ],
  propsSchema: siteContainerSchema,
  defaultProps: () => defaultContainerProps(),
  accepts: CHILD_TYPES,
  parents: [
    SITE_TYPES.section,
    SITE_TYPES.container,
    SITE_TYPES.slide,
    SITE_TYPES.tab,
    SITE_TYPES.accordionItem,
    SITE_TYPES.popup,
  ],
  freeLayout: {
    childPath: 'place',
    enabled: (props, breakpoint) =>
      resolveResponsive(props.positioning, breakpoint) === 'free',
  },
  inspector: [
    {
      id: 'layout',
      label: 'Layout',
      tab: 'content',
      fields: [
        {
          path: 'layout',
          label: 'Tipo',
          responsive: true,
          control: {
            kind: 'segmented',
            options: [
              { value: 'flex', label: 'Fluxo' },
              { value: 'grid', label: 'Grade' },
            ],
          },
        },
        {
          path: 'positioning',
          label: 'Posicionamento',
          help: 'Em "Livre", arraste cada elemento para onde quiser dentro do container (vale por tamanho de tela).',
          responsive: true,
          control: {
            kind: 'segmented',
            options: [
              { value: 'flow', label: 'Em fluxo' },
              { value: 'free', label: 'Livre' },
            ],
          },
        },
        {
          path: 'direction',
          label: 'Direção',
          responsive: true,
          showIf: (props) => props.layout !== 'grid',
          control: {
            kind: 'segmented',
            options: [
              { value: 'row', label: 'Linha' },
              { value: 'column', label: 'Coluna' },
            ],
          },
        },
        {
          path: 'wrap',
          label: 'Quebrar linha',
          responsive: true,
          showIf: (props) => props.layout !== 'grid',
          control: { kind: 'toggle' },
        },
        {
          path: 'columns',
          label: 'Colunas',
          responsive: true,
          showIf: (props) => props.layout !== 'flex',
          control: { kind: 'number', min: 1, max: 12 },
        },
        {
          path: 'columnsTemplate',
          label: 'Modelo de colunas',
          help: 'Opcional, em CSS (ex.: 2fr 1fr). Substitui o número de colunas.',
          responsive: true,
          showIf: (props) => props.layout !== 'flex',
          control: { kind: 'text', placeholder: '2fr 1fr', maxLength: 200 },
        },
        {
          path: 'gap',
          label: 'Espaço entre itens',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
        {
          path: 'alignItems',
          label: 'Alinhar itens',
          responsive: true,
          control: {
            kind: 'select',
            options: [
              { value: 'stretch', label: 'Esticar' },
              { value: 'start', label: 'Início' },
              { value: 'center', label: 'Centro' },
              { value: 'end', label: 'Fim' },
              { value: 'baseline', label: 'Linha de base' },
            ],
          },
        },
        {
          path: 'justify',
          label: 'Distribuir',
          responsive: true,
          control: {
            kind: 'select',
            options: [
              { value: 'start', label: 'Início' },
              { value: 'center', label: 'Centro' },
              { value: 'end', label: 'Fim' },
              { value: 'between', label: 'Espaço entre' },
              { value: 'around', label: 'Espaço ao redor' },
              { value: 'evenly', label: 'Espaço igual' },
            ],
          },
        },
        {
          path: 'textAlign',
          label: 'Alinhar texto',
          responsive: true,
          control: {
            kind: 'segmented',
            options: [
              { value: 'left', label: 'Esquerda', icon: 'text-left' },
              { value: 'center', label: 'Centro', icon: 'text-center' },
              { value: 'right', label: 'Direita', icon: 'text-right' },
            ],
          },
        },
        {
          path: 'tag',
          label: 'Tipo (HTML)',
          control: {
            kind: 'select',
            options: [
              { value: 'div', label: 'Neutro' },
              { value: 'article', label: 'Artigo' },
              { value: 'aside', label: 'Complementar' },
              { value: 'nav', label: 'Navegação' },
            ],
          },
        },
      ],
    },
    {
      id: 'size',
      label: 'Tamanho',
      tab: 'style',
      fields: [
        {
          path: 'grow',
          label: 'Ocupar espaço livre',
          responsive: true,
          control: { kind: 'toggle' },
        },
        {
          path: 'width',
          label: 'Largura',
          responsive: true,
          control: { kind: 'size', units: ['auto', 'px', '%', 'fill'] },
        },
        {
          path: 'maxWidth',
          label: 'Largura máxima',
          responsive: true,
          control: { kind: 'size', units: ['auto', 'px', '%'] },
        },
        {
          path: 'minHeight',
          label: 'Altura mínima',
          responsive: true,
          control: { kind: 'size', units: ['auto', 'px', 'vh'] },
        },
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', max: 400 },
        },
        marginField,
      ],
    },
    {
      id: 'background',
      label: 'Fundo e texto',
      tab: 'style',
      fields: [
        { path: 'background', label: 'Fundo', control: { kind: 'background' } },
        {
          path: 'textColor',
          label: 'Cor do texto',
          control: { kind: 'color', allowTokens: true },
        },
      ],
    },
    boxSection,
    advancedSection,
  ],
  render: ({
    node,
    children,
    attributes,
    editing,
  }: CanvasRenderProps<SiteContainerProps>) => {
    const Tag = node.props.tag
    return (
      <Tag
        {...attributes}
        id={anchorId(node.props.anchor)}
        className={classNames(node, 's-container')}
      >
        {children}
        {editing && !node.children?.length && (
          <EmptySlot label='Arraste elementos para cá' />
        )}
      </Tag>
    )
  },
})

// ─── columns (palette entry) ──────────────────────────────────────────────

/** Grid container with `count` column containers (stacked on mobile). */
export function columnsFragment(count = 2): CanvasFragment {
  const ids = Array.from({ length: count }, (_, i) => `col-${i}`)
  const nodes: CanvasFragment['nodes'] = {
    grid: {
      id: 'grid',
      type: SITE_TYPES.container,
      props: defaultContainerProps({
        layout: 'grid',
        columns: { base: count, mobile: 1 },
        gap: { base: 32, mobile: 24 },
      }),
      children: ids,
    },
  }
  for (const id of ids) {
    nodes[id] = {
      id,
      type: SITE_TYPES.container,
      props: defaultContainerProps(),
      children: [],
    }
  }
  return { rootId: 'grid', nodes }
}

export const columnsDefinition = defineComponent<SiteColumnsProps>({
  type: SITE_TYPES.columns,
  label: 'Colunas',
  icon: 'columns',
  category: 'Layout',
  keywords: ['grade', 'grid', '2 colunas', 'lado a lado'],
  propsSchema: siteColumnsSchema,
  defaultProps: () => ({}),
  accepts: false,
  parents: [
    SITE_TYPES.section,
    SITE_TYPES.container,
    SITE_TYPES.slide,
    SITE_TYPES.tab,
    SITE_TYPES.accordionItem,
    SITE_TYPES.popup,
  ],
  template: () => columnsFragment(2),
  inspector: [],
  render: ({ attributes }: CanvasRenderProps<SiteColumnsProps>): ReactNode =>
    attributes ? <div {...attributes} /> : null,
})
