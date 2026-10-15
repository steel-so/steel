import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { SITE_TYPES } from '../constants'
import { type SiteRenderContext, siteLink } from '../context'
import { classNames } from '../css'
import { IconSvg, SITE_ICONS, SOCIAL_NETWORKS } from '../icons'
import {
  ALIGN_OPTIONS,
  advancedSection,
  presetOptions,
  SITE_LINK_TARGETS,
  spacingSection,
} from '../inspector'
import { safeHref } from '../sanitize'
import {
  type SiteMenuProps,
  type SiteSocialProps,
  siteMenuSchema,
  siteSocialSchema,
} from '../schemas'

const anchorId = (anchor: string | undefined) => anchor || undefined

// ─── menu ─────────────────────────────────────────────────────────────────

interface MenuEntry {
  label: string
  href?: string
  target?: '_blank'
  rel?: string
  current: boolean
}

/** Sample entries shown in the editor while the site has no pages. */
const SAMPLE_PAGES = ['Início', 'Sobre', 'Serviços', 'Contato']

export function menuEntries(
  p: SiteMenuProps,
  ctx: SiteRenderContext,
  editing: boolean,
): MenuEntry[] {
  if (p.source === 'custom') {
    return p.items.map((item) => ({
      label: item.label,
      ...siteLink(item.link, ctx),
      current: false,
    }))
  }
  const pages = (ctx.pages ?? []).filter(
    (page) => !page.parentId && page.showInMenu !== false,
  )
  if (pages.length === 0 && editing) {
    return SAMPLE_PAGES.map((label, index) => ({ label, current: index === 0 }))
  }
  return pages.map((page) => ({
    label: page.title,
    ...siteLink({ type: 'page', value: page.id }, ctx),
    current: page.id === ctx.currentPageId,
  }))
}

function MenuList({
  entries,
  className,
}: {
  entries: MenuEntry[]
  className: string
}) {
  return (
    <ul className={className}>
      {entries.map((entry, index) => (
        <li key={index}>
          <a
            className='s-menu-link'
            href={entry.href}
            target={entry.target}
            rel={entry.rel}
            aria-current={entry.current ? 'page' : undefined}
          >
            {entry.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function menuDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteMenuProps>({
    type: SITE_TYPES.menu,
    label: 'Menu',
    icon: 'menu',
    category: 'Navegação',
    keywords: ['navegação', 'links', 'páginas', 'hambúrguer', 'nav'],
    propsSchema: siteMenuSchema,
    defaultProps: () => ({
      source: 'pages',
      items: [],
      orientation: 'horizontal',
      justify: 'end',
      gap: 32,
      preset: 'body',
      collapse: 'tablet',
      label: 'Menu principal',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Menu',
        tab: 'content',
        fields: [
          {
            path: 'source',
            label: 'Itens',
            control: {
              kind: 'segmented',
              options: [
                { value: 'pages', label: 'Páginas do site' },
                { value: 'custom', label: 'Personalizado' },
              ],
            },
          },
          {
            path: 'items',
            label: 'Links',
            showIf: { path: 'source', equals: 'custom' },
            control: {
              kind: 'list',
              itemLabel: 'Link',
              max: 30,
              fields: [
                {
                  path: 'label',
                  label: 'Texto',
                  control: { kind: 'text', maxLength: 80 },
                },
                {
                  path: 'link',
                  label: 'Destino',
                  control: { kind: 'link', targets: SITE_LINK_TARGETS },
                },
              ],
            },
          },
          {
            path: 'label',
            label: 'Nome do menu (acessibilidade)',
            control: { kind: 'text', maxLength: 80 },
          },
          {
            path: 'collapse',
            label: 'Virar menu hambúrguer',
            control: {
              kind: 'select',
              options: [
                { value: 'tablet', label: 'No tablet e no celular' },
                { value: 'mobile', label: 'Só no celular' },
                { value: 'never', label: 'Nunca' },
              ],
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
            path: 'orientation',
            label: 'Direção',
            control: {
              kind: 'segmented',
              options: [
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical', label: 'Vertical' },
              ],
            },
          },
          {
            path: 'justify',
            label: 'Alinhamento',
            responsive: true,
            control: {
              kind: 'segmented',
              options: [
                { value: 'start', label: 'Início', icon: 'align-left' },
                { value: 'center', label: 'Centro', icon: 'align-center' },
                { value: 'end', label: 'Fim', icon: 'align-right' },
              ],
            },
          },
          {
            path: 'gap',
            label: 'Espaço entre links',
            responsive: true,
            control: { kind: 'number', min: 0, max: 400, unit: 'px' },
          },
          {
            path: 'preset',
            label: 'Estilo do tema',
            control: {
              kind: 'select',
              options: presetOptions(['lead', 'body', 'small']),
            },
          },
          {
            path: 'color',
            label: 'Cor dos links',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'hoverColor',
            label: 'Cor ao passar o mouse',
            control: { kind: 'color', allowTokens: true },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SiteMenuProps>) => {
      const p = node.props
      const entries = menuEntries(p, ctx, editing)
      if (entries.length === 0 && !editing) return null
      const listClass = `s-menu-list s-t-${p.preset}`
      return (
        <nav
          {...attributes}
          id={anchorId(p.anchor)}
          aria-label={p.label || 'Menu'}
          className={classNames(
            node,
            's-menu',
            p.collapse !== 'never' && `s-menu-collapse-${p.collapse}`,
          )}
        >
          <MenuList
            entries={entries}
            className={`${listClass} s-menu-inline`}
          />
          {p.collapse !== 'never' && (
            <details className='s-menu-burger'>
              <summary aria-label='Abrir menu'>
                <IconSvg icon={SITE_ICONS.menu.svg} />
              </summary>
              <MenuList entries={entries} className={listClass} />
            </details>
          )}
        </nav>
      )
    },
  })
}

// ─── social ───────────────────────────────────────────────────────────────

export const socialDefinition = defineComponent<SiteSocialProps>({
  type: SITE_TYPES.social,
  label: 'Redes sociais',
  icon: 'social',
  category: 'Navegação',
  keywords: ['instagram', 'facebook', 'linkedin', 'whatsapp', 'ícones'],
  propsSchema: siteSocialSchema,
  defaultProps: () => ({
    items: [
      { network: 'instagram', url: 'https://instagram.com/' },
      { network: 'facebook', url: 'https://facebook.com/' },
      { network: 'linkedin', url: 'https://linkedin.com/' },
    ],
    size: 40,
    color: 'token:text',
    background: 'token:surface',
    shape: 'circle',
    gap: 12,
    align: 'left',
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Perfis',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Perfis',
          control: {
            kind: 'list',
            itemLabel: 'Perfil',
            max: 12,
            fields: [
              {
                path: 'network',
                label: 'Rede',
                control: {
                  kind: 'select',
                  options: Object.entries(SOCIAL_NETWORKS).map(
                    ([value, network]) => ({ value, label: network.label }),
                  ),
                },
              },
              {
                path: 'url',
                label: 'Endereço do perfil',
                control: { kind: 'text', placeholder: 'https://…' },
              },
            ],
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
          path: 'size',
          label: 'Tamanho',
          responsive: true,
          control: { kind: 'number', min: 12, max: 96, unit: 'px' },
        },
        {
          path: 'shape',
          label: 'Fundo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'none', label: 'Nenhum' },
              { value: 'circle', label: 'Círculo' },
              { value: 'rounded', label: 'Arredondado' },
            ],
          },
        },
        {
          path: 'color',
          label: 'Cor do ícone',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'background',
          label: 'Cor do fundo',
          showIf: (props) => props.shape !== 'none',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'gap',
          label: 'Espaço entre ícones',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
        {
          path: 'align',
          label: 'Alinhamento',
          responsive: true,
          control: { kind: 'segmented', options: ALIGN_OPTIONS },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    attributes,
    editing,
  }: CanvasRenderProps<SiteSocialProps>) => {
    const p = node.props
    const items = p.items
      .map((item) => ({ ...item, href: safeHref(item.url) }))
      .filter((item) => editing || item.href)
    if (items.length === 0 && !editing) return null
    return (
      <ul
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-social')}
      >
        {items.map((item, index) => {
          const network = SOCIAL_NETWORKS[item.network]
          return (
            <li key={index}>
              <a
                href={item.href}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={network.label}
              >
                <IconSvg icon={network.svg} />
              </a>
            </li>
          )
        })}
      </ul>
    )
  },
})
