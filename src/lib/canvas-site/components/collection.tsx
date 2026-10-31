import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import type { SiteCmsItem, SiteCmsValue } from '../cms'
import { SITE_TYPES } from '../constants'
import type { SiteRenderContext } from '../context'
import { classNames } from '../css'
import {
  ALIGN_OPTIONS,
  ASPECT_RATIO_LABELS,
  advancedSection,
  spacingSection,
} from '../inspector'
import { safeHref, safeSrc } from '../sanitize'
import { ASPECT_RATIOS, HEADING_LEVELS } from '../schemas'
import {
  type SiteCollectionFieldProps,
  type SiteCollectionListProps,
  siteCollectionFieldSchema,
  siteCollectionListSchema,
} from '../schemas-cms'

/**
 * Collection elements (slice site-blog): a list of a collection's items
 * (cases, equipe, vagas, imóveis…) and one field of the current item, for
 * the item template page. Values come formatted from `ctx.cms`.
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

function Placeholder({ label }: { label: string }) {
  return <div className='s-placeholder'>{label}</div>
}

function fieldPicker(
  ctx: SiteRenderContext,
  path: string,
  label: string,
  help?: string,
): InspectorField {
  return {
    path,
    label,
    help,
    control: ctx.collectionFieldPicker
      ? { kind: 'custom', component: ctx.collectionFieldPicker }
      : { kind: 'text', placeholder: 'campo', maxLength: 60 },
  }
}

/** A value as inline content (text, link, image). */
function ValueView({ value }: { value: SiteCmsValue }) {
  switch (value.type) {
    case 'richtext':
      return (
        <div
          className='s-rich'
          // Sanitized by the loader (`sanitizeRichText`).
          dangerouslySetInnerHTML={{ __html: value.html ?? '' }}
        />
      )
    case 'image': {
      const src = safeSrc(value.url)
      return src ? (
        <img src={src} alt={value.alt ?? ''} loading='lazy' decoding='async' />
      ) : null
    }
    case 'link':
    case 'reference':
    case 'product': {
      const href = safeHref(value.url)
      return href ? <a href={href}>{value.text}</a> : value.text
    }
    default:
      return <>{value.text}</>
  }
}

function ItemCard({
  item,
  p,
}: {
  item: SiteCmsItem
  p: SiteCollectionListProps
}) {
  const Title = p.titleLevel
  const image = p.imageField ? item.values[p.imageField] : undefined
  const imageSrc = image?.type === 'image' ? safeSrc(image.url) : undefined
  const text = p.textField ? item.values[p.textField] : undefined
  const meta = p.metaField ? item.values[p.metaField] : undefined
  const href = safeHref(item.href)
  return (
    <article className='s-pcard s-ccard'>
      {imageSrc ? (
        <div className='s-pcard-media'>
          <img
            src={imageSrc}
            alt={href ? '' : (image?.alt ?? '')}
            loading='lazy'
            decoding='async'
          />
        </div>
      ) : null}
      <div className='s-pcard-body'>
        {meta?.text ? <p className='s-pmeta'>{meta.text}</p> : null}
        <Title className='s-pcard-title'>
          {href ? <a href={href}>{item.title}</a> : item.title}
        </Title>
        {text ? (
          text.type === 'richtext' ? (
            <ValueView value={text} />
          ) : (
            <p className='s-pcard-excerpt'>{text.text}</p>
          )
        ) : null}
        {p.showButton && href ? (
          <a className='s-btn s-btn-outline s-btn-sm s-ccard-btn' href={href}>
            {p.buttonLabel || 'Ver mais'}
            <span className='s-sr'>: {item.title}</span>
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function collectionListDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteCollectionListProps>({
    type: SITE_TYPES.collectionList,
    label: 'Lista da coleção',
    icon: 'collectionList',
    category: 'Coleções',
    keywords: [
      'coleção',
      'cms',
      'casos',
      'equipe',
      'vagas',
      'imóveis',
      'itens',
    ],
    propsSchema: siteCollectionListSchema,
    defaultProps: () => ({
      collectionId: '',
      layout: 'grid',
      columns: { base: 3, tablet: 2, mobile: 1 },
      limit: 12,
      sort: 'position',
      imageField: '',
      textField: '',
      metaField: '',
      showButton: false,
      buttonLabel: 'Ver mais',
      titleLevel: 'h3',
      aspectRatio: '4/3',
      gap: { base: 32, mobile: 24 },
      emptyText: 'Nenhum item publicado ainda.',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Coleção',
        tab: 'content',
        fields: [
          {
            path: 'collectionId',
            label: 'Coleção',
            control: ctx.collectionPicker
              ? { kind: 'custom', component: ctx.collectionPicker }
              : { kind: 'text', placeholder: 'id da coleção', maxLength: 64 },
          },
          fieldPicker(ctx, 'imageField', 'Imagem do cartão'),
          fieldPicker(ctx, 'textField', 'Texto do cartão'),
          fieldPicker(ctx, 'metaField', 'Detalhe acima do título'),
          {
            path: 'sort',
            label: 'Ordem',
            control: {
              kind: 'select',
              options: [
                { value: 'position', label: 'Ordem da coleção' },
                { value: 'newest', label: 'Mais recentes' },
                { value: 'title', label: 'Título (A–Z)' },
              ],
            },
          },
          {
            path: 'limit',
            label: 'Quantidade máxima',
            control: { kind: 'number', min: 1, max: 48 },
          },
          {
            path: 'showButton',
            label: 'Botão para o item',
            help: 'Aparece quando a coleção tem página de item.',
            control: { kind: 'toggle' },
          },
          {
            path: 'buttonLabel',
            label: 'Texto do botão',
            showIf: { path: 'showButton', equals: true },
            control: { kind: 'text', maxLength: 40 },
          },
          {
            path: 'emptyText',
            label: 'Texto sem itens',
            control: { kind: 'text', maxLength: 200 },
          },
        ],
      },
      {
        id: 'layout',
        label: 'Layout',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'Estilo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'grid', label: 'Grade' },
                { value: 'list', label: 'Lista' },
              ],
            },
          },
          {
            path: 'columns',
            label: 'Colunas',
            responsive: true,
            showIf: { path: 'layout', equals: 'grid' },
            control: { kind: 'number', min: 1, max: 4 },
          },
          {
            path: 'aspectRatio',
            label: 'Proporção da imagem',
            control: {
              kind: 'select',
              options: ASPECT_RATIOS.map((value) => ({
                value,
                label: ASPECT_RATIO_LABELS[value] ?? value,
              })),
            },
          },
          {
            path: 'titleLevel',
            label: 'Nível do título (SEO)',
            control: {
              kind: 'segmented',
              options: [
                { value: 'h2', label: 'H2' },
                { value: 'h3', label: 'H3' },
                { value: 'h4', label: 'H4' },
              ],
            },
          },
          {
            path: 'gap',
            label: 'Espaço entre itens',
            responsive: true,
            control: { kind: 'number', min: 0, max: 400, unit: 'px' },
          },
          {
            path: 'background',
            label: 'Fundo do cartão',
            control: {
              kind: 'color',
              allowTokens: true,
              allowTransparent: true,
            },
          },
          { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
          { path: 'border', label: 'Borda', control: { kind: 'border' } },
          { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SiteCollectionListProps>) => {
      const p = node.props
      const list =
        ctx.cms?.collections?.[node.id] ?? ctx.cms?.collectionList?.(node.id, p)
      const items = list?.items ?? []
      if (items.length === 0) {
        if (editing) {
          return (
            <div {...attributes}>
              <Placeholder
                label={
                  p.collectionId
                    ? 'Os itens publicados da coleção aparecem aqui'
                    : 'Escolha uma coleção no painel à direita'
                }
              />
            </div>
          )
        }
        return p.emptyText ? (
          <p
            id={anchorId(p.anchor)}
            className={classNames(node, 's-plist-empty')}
          >
            {p.emptyText}
          </p>
        ) : null
      }
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(
            node,
            's-plist',
            `s-plist-${p.layout === 'grid' ? 'cards' : 'list'}`,
          )}
        >
          <ul className='s-plist-items'>
            {items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} p={p} />
              </li>
            ))}
          </ul>
        </div>
      )
    },
  })
}

export function collectionFieldDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteCollectionFieldProps>({
    type: SITE_TYPES.collectionField,
    label: 'Campo do item',
    icon: 'collectionField',
    category: 'Coleções',
    keywords: ['campo', 'coleção', 'cms', 'item', 'dinâmico'],
    propsSchema: siteCollectionFieldSchema,
    defaultProps: () => ({
      fieldKey: 'title',
      display: 'heading',
      level: 'h1',
      label: '',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Campo',
        tab: 'content',
        fields: [
          fieldPicker(
            ctx,
            'fieldKey',
            'Campo',
            'Use no modelo da página do item: mostra o valor de cada item.',
          ),
          {
            path: 'label',
            label: 'Rótulo antes do valor',
            control: { kind: 'text', maxLength: 60, placeholder: 'Local:' },
          },
          {
            path: 'display',
            label: 'Exibir texto como',
            control: {
              kind: 'segmented',
              options: [
                { value: 'auto', label: 'Automático' },
                { value: 'heading', label: 'Título' },
              ],
            },
          },
          {
            path: 'level',
            label: 'Nível do título (SEO)',
            showIf: { path: 'display', equals: 'heading' },
            control: {
              kind: 'segmented',
              options: HEADING_LEVELS.map((level) => ({
                value: level,
                label: level.toUpperCase(),
              })),
            },
          },
        ],
      },
      {
        id: 'style',
        label: 'Texto',
        tab: 'style',
        fields: [
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            control: { kind: 'segmented', options: ALIGN_OPTIONS },
          },
          {
            path: 'color',
            label: 'Cor do texto',
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
    }: CanvasRenderProps<SiteCollectionFieldProps>) => {
      const p = node.props
      const item = ctx.cms?.item
      const value: SiteCmsValue | undefined =
        p.fieldKey === 'title' && item
          ? { type: 'text', text: item.title }
          : p.fieldKey
            ? item?.values[p.fieldKey]
            : undefined
      const empty = !value || (!value.text && !value.html && !value.url)
      if (empty) {
        return editing ? (
          <div {...attributes}>
            <Placeholder
              label={
                p.fieldKey
                  ? `Valor do campo “${p.fieldKey}” de cada item`
                  : 'Escolha um campo no painel à direita'
              }
            />
          </div>
        ) : null
      }
      const label = p.label ? (
        <span className='s-cfield-label'>{p.label} </span>
      ) : null
      const isText = ['text', 'number', 'date'].includes(value.type)
      if (isText && p.display === 'heading') {
        const Tag = p.level
        return (
          <Tag
            {...attributes}
            id={anchorId(p.anchor)}
            className={classNames(node, `s-t-${p.level}`, 's-cfield')}
          >
            {label}
            {value.text}
          </Tag>
        )
      }
      const Tag =
        value.type === 'richtext' || value.type === 'image' ? 'div' : 'p'
      return (
        <Tag
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-cfield', `s-cfield-${value.type}`)}
        >
          {label}
          <ValueView value={value} />
        </Tag>
      )
    },
  })
}
