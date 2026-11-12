import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  GalleryThumbnailsIcon,
  Image01Icon,
  InformationCircleIcon,
  Note01Icon,
  PlayIcon,
  TableIcon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { CSSProperties } from 'react'
import { getNode } from '@/src/lib/canvas/nodes'
import {
  type CanvasComponentDefinition,
  defineComponent,
} from '@/src/lib/canvas/registry'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { resolveColor } from '@/src/lib/canvas/values'
import { IconSvg, SITE_ICONS } from '@/src/lib/canvas-site/icons'
import {
  safeHref,
  safeSrc,
  videoEmbedUrl,
  vimeoId,
  youtubeId,
} from '@/src/lib/canvas-site/sanitize'
import { BLOCK_TYPE_SET } from '../blocks'
import { TableControl } from '../controls'
import {
  ALIGN_OPTIONS,
  alignField,
  colorField,
  radiusField,
  section,
  textField,
  toggleField,
  VARIABLES_HELP,
} from '../inspector'
import {
  BUTTON_VARIANTS,
  CALLOUT_TONES,
  type DocumentAccordionItemProps,
  type DocumentAccordionProps,
  type DocumentButtonProps,
  type DocumentCalloutProps,
  type DocumentContactCardProps,
  type DocumentGalleryProps,
  type DocumentHeadingProps,
  type DocumentIconProps,
  type DocumentImageProps,
  type DocumentListProps,
  type DocumentLogosProps,
  type DocumentQuoteProps,
  type DocumentStatsProps,
  type DocumentTableProps,
  type DocumentTestimonialsProps,
  type DocumentTextProps,
  type DocumentTocProps,
  type DocumentVideoProps,
  documentAccordionItemSchema,
  documentAccordionSchema,
  documentButtonSchema,
  documentCalloutSchema,
  documentContactCardSchema,
  documentGallerySchema,
  documentHeadingSchema,
  documentIconSchema,
  documentImageSchema,
  documentListSchema,
  documentLogosSchema,
  documentQuoteSchema,
  documentStatsSchema,
  documentTableSchema,
  documentTestimonialsSchema,
  documentTextSchema,
  documentTocSchema,
  documentVideoSchema,
} from '../schemas'
import { type DocumentSectionInfo, documentSections } from '../sections'
import { LiveVideo } from './live'
import {
  alignSelfFor,
  type DocCtx,
  initials,
  justifyFor,
  linkProps,
  Placeholder,
  renderVars,
  richHtml,
  trackProps,
  varsText,
} from './shared'

/** Content elements: text, lists, tables, media and the showcase blocks
 * (stats, testimonials, logos), the table of contents and the contact
 * card. Every text resolves merge tags. */

const HEADING_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' } as const

const TONE_ICONS = {
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: Alert02Icon,
  neutral: Note01Icon,
}

const TONE_LABELS: Record<string, string> = {
  info: 'Informação',
  success: 'Sucesso',
  warning: 'Atenção',
  neutral: 'Nota',
}

const BUTTON_LABELS: Record<string, string> = {
  primary: 'Principal',
  secondary: 'Suave',
  outline: 'Contorno',
}

/** Inline style with a CSS custom property (`--d-cols`). */
function cssVars(vars: Record<string, string | number | undefined>) {
  return vars as CSSProperties
}

export interface VideoSource {
  kind: 'embed' | 'file' | 'none'
  embedUrl?: string
  thumbnail?: string
  fileUrl?: string
}

/** Hosted video of a URL: YouTube/Vimeo embed + thumbnail, or a file. */
export function videoSource(url: string): VideoSource {
  const value = url.trim()
  if (!value) return { kind: 'none' }
  const options = { autoplay: true, muted: false, loop: false, controls: true }
  const youtube = youtubeId(value)
  if (youtube) {
    return {
      kind: 'embed',
      embedUrl: videoEmbedUrl('youtube', value, options) ?? undefined,
      thumbnail: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`,
    }
  }
  if (vimeoId(value)) {
    return {
      kind: 'embed',
      embedUrl: videoEmbedUrl('vimeo', value, options) ?? undefined,
    }
  }
  const file = safeSrc(value)
  if (file && /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(file)) {
    return { kind: 'file', fileUrl: file }
  }
  return { kind: 'none' }
}

/** Sections the table of contents lists (covers left out). */
function tocEntries(doc: CanvasDocument): DocumentSectionInfo[] {
  const entries: DocumentSectionInfo[] = []
  for (const info of documentSections(doc)) {
    if (getNode(doc, info.id)?.props.variant !== 'cover') entries.push(info)
  }
  return entries
}

function headingLevel(level: string | number | undefined): 1 | 2 | 3 | 4 {
  const value = Number(level)
  return value === 1 || value === 3 || value === 4 ? value : 2
}

export function contentDefinitions(ctx: DocCtx): CanvasComponentDefinition[] {
  const editing = ctx.mode === 'editor'
  const print = ctx.mode === 'print'

  const heading = defineComponent<DocumentHeadingProps>({
    type: 'heading',
    label: 'Título',
    icon: 'heading',
    category: 'Texto',
    keywords: ['título', 'titulo', 'cabeçalho', 'h1', 'h2', 'subtítulo'],
    propsSchema: documentHeadingSchema,
    defaultProps: () => ({ text: 'Título da seção', level: '2' }),
    accepts: false,
    inlineText: { path: 'text', rich: false },
    inspector: [
      section('heading', 'Título', [
        textField('text', 'Texto', {
          rows: 2,
          maxLength: 500,
          help: VARIABLES_HELP,
        }),
        {
          path: 'level',
          label: 'Nível',
          help: 'O nível 1 é o título principal; use os outros nas seções.',
          control: {
            kind: 'segmented',
            options: [1, 2, 3, 4].map((level) => ({
              value: String(level),
              label: `T${level}`,
            })),
          },
        },
        textField('eyebrow', 'Rótulo acima do título', { maxLength: 120 }),
      ]),
      section(
        'heading-style',
        'Texto',
        [alignField, colorField('color', 'Cor')],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const level = headingLevel(p.level)
      const Tag = HEADING_TAGS[level]
      const style: CSSProperties = {
        textAlign: p.align,
        color: resolveColor(p.color),
      }
      if (!p.eyebrow) {
        return (
          <Tag {...attributes} className={`d-h d-h${level}`} style={style}>
            {renderVars(p.text, ctx)}
          </Tag>
        )
      }
      return (
        <div {...attributes} className='d-heading' style={style}>
          <span className='d-eyebrow'>{renderVars(p.eyebrow, ctx)}</span>
          <Tag className={`d-h d-h${level}`}>{renderVars(p.text, ctx)}</Tag>
        </div>
      )
    },
  })

  const text = defineComponent<DocumentTextProps>({
    type: 'text',
    label: 'Texto',
    icon: 'text',
    category: 'Texto',
    keywords: ['parágrafo', 'paragrafo', 'texto', 'conteúdo', 'cláusula'],
    propsSchema: documentTextSchema,
    defaultProps: () => ({
      html: '<p>Escreva o texto aqui. Clique duas vezes para editar.</p>',
    }),
    accepts: false,
    inlineText: { path: 'html', rich: true },
    inspector: [
      section('text', 'Texto', [
        {
          path: 'html',
          label: 'Conteúdo',
          help: VARIABLES_HELP,
          control: {
            kind: 'richtext',
            marks: ['bold', 'italic', 'underline', 'strike', 'link', 'list'],
          },
        },
      ]),
      section(
        'text-style',
        'Texto',
        [
          {
            path: 'size',
            label: 'Tamanho',
            control: {
              kind: 'segmented',
              options: [
                { value: 'sm', label: 'Pequeno' },
                { value: 'md', label: 'Normal' },
                { value: 'lg', label: 'Grande' },
              ],
            },
          },
          {
            path: 'align',
            label: 'Alinhamento',
            control: {
              kind: 'segmented',
              options: [
                ...ALIGN_OPTIONS,
                {
                  value: 'justify',
                  label: 'Justificado',
                  icon: 'text-justify',
                },
              ],
            },
          },
          colorField('color', 'Cor'),
        ],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const size = p.size && p.size !== 'md' ? ` d-text--${p.size}` : ''
      return (
        <div
          {...attributes}
          className={`d-text${size}`}
          style={{ textAlign: p.align, color: resolveColor(p.color) }}
          dangerouslySetInnerHTML={{ __html: richHtml(p.html, ctx) }}
        />
      )
    },
  })

  const list = defineComponent<DocumentListProps>({
    type: 'list',
    label: 'Lista',
    icon: 'list',
    category: 'Texto',
    keywords: ['lista', 'tópicos', 'itens', 'checklist', 'escopo'],
    propsSchema: documentListSchema,
    defaultProps: () => ({
      marker: 'check',
      items: [
        { text: 'Primeiro item da lista' },
        { text: 'Segundo item da lista' },
        { text: 'Terceiro item da lista' },
      ],
    }),
    accepts: false,
    inspector: [
      section('list', 'Lista', [
        {
          path: 'items',
          label: 'Itens',
          control: {
            kind: 'list',
            itemLabel: 'Item',
            max: 100,
            fields: [
              {
                path: 'text',
                label: 'Texto',
                control: { kind: 'textarea', rows: 2, maxLength: 2000 },
              },
            ],
          },
        },
        {
          path: 'marker',
          label: 'Marcador',
          control: {
            kind: 'segmented',
            options: [
              { value: 'check', label: 'Visto' },
              { value: 'bullet', label: 'Ponto' },
              { value: 'number', label: 'Número' },
            ],
          },
        },
      ]),
      section(
        'list-style',
        'Marcador',
        [colorField('color', 'Cor do marcador')],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const marker = p.marker ?? 'bullet'
      const Tag = marker === 'number' ? 'ol' : 'ul'
      const items = p.items.filter((item) => item.text?.trim())
      return (
        <Tag
          {...attributes}
          className={`d-list d-list--${marker}`}
          style={cssVars({ '--d-marker': resolveColor(p.color) })}
        >
          {items.map((item, index) => (
            <li key={index}>{renderVars(item.text, ctx)}</li>
          ))}
        </Tag>
      )
    },
  })

  const quote = defineComponent<DocumentQuoteProps>({
    type: 'quote',
    label: 'Citação',
    icon: 'quote',
    category: 'Texto',
    keywords: ['citação', 'citacao', 'frase', 'depoimento', 'destaque'],
    propsSchema: documentQuoteSchema,
    defaultProps: () => ({
      text: 'Uma frase que resume a proposta de valor do seu trabalho.',
      author: 'Nome do autor',
    }),
    accepts: false,
    inlineText: { path: 'text', rich: false },
    inspector: [
      section('quote', 'Citação', [
        textField('text', 'Frase', { rows: 3, maxLength: 2000 }),
        textField('author', 'Autor', { maxLength: 500 }),
        textField('role', 'Cargo ou empresa', { maxLength: 500 }),
        {
          path: 'size',
          label: 'Tamanho',
          control: {
            kind: 'segmented',
            options: [
              { value: 'md', label: 'Normal' },
              { value: 'lg', label: 'Grande' },
            ],
          },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      return (
        <blockquote
          {...attributes}
          className={p.size === 'lg' ? 'd-quote d-quote--lg' : 'd-quote'}
        >
          <p>{renderVars(p.text, ctx)}</p>
          {p.author ? (
            <footer>
              <strong>{renderVars(p.author, ctx)}</strong>
              {p.role ? <span>, {renderVars(p.role, ctx)}</span> : null}
            </footer>
          ) : null}
        </blockquote>
      )
    },
  })

  const callout = defineComponent<DocumentCalloutProps>({
    type: 'callout',
    label: 'Aviso',
    icon: 'callout',
    category: 'Texto',
    keywords: ['aviso', 'nota', 'destaque', 'atenção', 'importante'],
    propsSchema: documentCalloutSchema,
    defaultProps: () => ({
      tone: 'info',
      title: 'Importante',
      text: 'Use este bloco para destacar uma condição ou observação.',
    }),
    accepts: false,
    inlineText: { path: 'text', rich: false },
    inspector: [
      section('callout', 'Aviso', [
        textField('title', 'Título', { maxLength: 500 }),
        textField('text', 'Texto', { rows: 4, maxLength: 2000 }),
        {
          path: 'tone',
          label: 'Tom',
          control: {
            kind: 'select',
            options: CALLOUT_TONES.map((value) => ({
              value,
              label: TONE_LABELS[value],
            })),
          },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const tone = p.tone ?? 'info'
      return (
        <div
          {...attributes}
          className={`d-callout d-callout--${tone}`}
          role='note'
        >
          <span className='d-callout-icon'>
            <IconSvg icon={TONE_ICONS[tone]} />
          </span>
          <div className='d-callout-body'>
            {p.title ? (
              <strong className='d-callout-title'>
                {renderVars(p.title, ctx)}
              </strong>
            ) : null}
            {renderVars(p.text, ctx)}
          </div>
        </div>
      )
    },
  })

  const table = defineComponent<DocumentTableProps>({
    type: 'table',
    label: 'Tabela',
    icon: 'table',
    category: 'Texto',
    keywords: ['tabela', 'cronograma', 'planilha', 'grade', 'comparativo'],
    propsSchema: documentTableSchema,
    defaultProps: () => ({
      headerRow: true,
      rows: [
        ['Etapa', 'Prazo', 'Responsável'],
        ['Kickoff e levantamento', '1 semana', '{{responsavel.nome}}'],
        ['Implantação', '3 semanas', 'Equipe técnica'],
      ],
    }),
    accepts: false,
    inspector: [
      section('table', 'Tabela', [
        {
          path: 'rows',
          label: 'Linhas',
          help: 'Uma linha por linha; separe as colunas com |.',
          control: { kind: 'custom', component: TableControl },
        },
        toggleField('headerRow', 'A primeira linha é o cabeçalho'),
        toggleField('striped', 'Linhas zebradas'),
        toggleField('compact', 'Compacta'),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const rows = p.rows.filter((row) => row.some((cell) => cell.trim()))
      if (rows.length === 0) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={TableIcon}
            title='Tabela vazia'
            hint='Preencha as linhas no painel ao lado.'
          />
        ) : null
      }
      const width = Math.max(...rows.map((row) => row.length))
      const pad = (row: string[]) =>
        Array.from({ length: width }, (_, index) => row[index] ?? '')
      const [first, ...rest] = rows
      const header = p.headerRow ? first : null
      const body = p.headerRow ? rest : rows
      let className = 'd-table'
      if (header) className += ' d-table--labeled'
      if (p.striped) className += ' d-table--striped'
      if (p.compact) className += ' d-table--compact'
      return (
        <div {...attributes} className='d-table-wrap'>
          <table className={className}>
            {header ? (
              <thead>
                <tr>
                  {pad(header).map((cell, index) => (
                    <th key={index}>{renderVars(cell, ctx)}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {pad(row).map((cell, index) => (
                    <td
                      key={index}
                      data-label={header ? plainLabel(header[index]) : undefined}
                    >
                      {renderVars(cell, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    },
  })

  const button = defineComponent<DocumentButtonProps>({
    type: 'button',
    label: 'Botão',
    icon: 'button',
    category: 'Texto',
    keywords: ['botão', 'botao', 'link', 'chamada', 'cta'],
    propsSchema: documentButtonSchema,
    defaultProps: () => ({
      label: 'Saiba mais',
      link: { type: 'url', value: '' },
      variant: 'primary',
    }),
    accepts: false,
    inlineText: { path: 'label', rich: false },
    inspector: [
      section('button', 'Botão', [
        textField('label', 'Texto', { maxLength: 500 }),
        {
          path: 'link',
          label: 'Link',
          control: { kind: 'link', targets: ['url', 'email', 'phone', 'file'] },
        },
      ]),
      section(
        'button-style',
        'Aparência',
        [
          {
            path: 'variant',
            label: 'Estilo',
            control: {
              kind: 'segmented',
              options: BUTTON_VARIANTS.map((value) => ({
                value,
                label: BUTTON_LABELS[value],
              })),
            },
          },
          alignField,
          toggleField('fullWidth', 'Largura total'),
        ],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const link = linkProps(p.link, ctx)
      let className = `d-btn d-btn--${p.variant ?? 'primary'}`
      if (p.fullWidth) className += ' d-btn--block'
      const label = renderVars(p.label, ctx)
      return (
        <div
          {...attributes}
          className='d-btn-wrap'
          style={{ justifyContent: justifyFor(p.align) }}
        >
          {link.href ? (
            <a {...link} {...trackProps(ctx, 'link')} className={className}>
              {label}
            </a>
          ) : (
            <span className={className}>{label}</span>
          )}
        </div>
      )
    },
  })

  const image = defineComponent<DocumentImageProps>({
    type: 'image',
    label: 'Imagem',
    icon: 'image',
    category: 'Mídia',
    keywords: ['imagem', 'foto', 'figura', 'logo', 'banner'],
    propsSchema: documentImageSchema,
    defaultProps: () => ({ src: '', alt: '' }),
    accepts: false,
    inspector: [
      section('image', 'Imagem', [
        {
          path: 'src',
          label: 'Imagem',
          control: { kind: 'text', placeholder: 'https://…', maxLength: 2000 },
          help: 'Endereço da imagem (envie pela biblioteca de mídia e cole o link).',
        },
        textField('alt', 'Texto alternativo', { maxLength: 500 }),
        textField('caption', 'Legenda', { maxLength: 500 }),
      ]),
      section(
        'image-style',
        'Aparência',
        [
          {
            path: 'width',
            label: 'Largura (%)',
            control: { kind: 'number', min: 10, max: 100, unit: '%' },
          },
          alignField,
          radiusField,
          toggleField('border', 'Borda fina'),
        ],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const src = safeSrc(p.src)
      if (!src) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={Image01Icon}
            title='Imagem'
            hint='Cole o endereço da imagem no painel ao lado.'
          />
        ) : null
      }
      const width = p.width ?? 100
      return (
        <figure
          {...attributes}
          className='d-figure'
          style={{
            width: `${width}%`,
            alignSelf: width < 100 ? alignSelfFor(p.align) : undefined,
          }}
        >
          <img
            src={src}
            alt={varsText(p.alt, ctx)}
            loading={print ? undefined : 'lazy'}
            style={{
              borderRadius: p.radius ?? 'var(--d-radius)',
              border: p.border ? '1px solid var(--canvas-border)' : undefined,
            }}
          />
          {p.caption ? (
            <figcaption>{renderVars(p.caption, ctx)}</figcaption>
          ) : null}
        </figure>
      )
    },
  })

  const icon = defineComponent<DocumentIconProps>({
    type: 'icon',
    label: 'Ícone',
    icon: 'icon',
    category: 'Mídia',
    keywords: ['ícone', 'icone', 'símbolo', 'simbolo'],
    propsSchema: documentIconSchema,
    defaultProps: () => ({ name: 'star', size: 40, badge: true }),
    accepts: false,
    inspector: [
      section('icon', 'Ícone', [
        {
          path: 'name',
          label: 'Ícone',
          control: {
            kind: 'select',
            options: Object.entries(SITE_ICONS).map(([value, entry]) => ({
              value,
              label: entry.label,
            })),
          },
        },
        {
          path: 'size',
          label: 'Tamanho (px)',
          control: { kind: 'number', min: 12, max: 160, unit: 'px' },
        },
        toggleField('badge', 'Com fundo'),
      ]),
      section(
        'icon-style',
        'Aparência',
        [alignField, colorField('color', 'Cor')],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const entry = SITE_ICONS[p.name] ?? SITE_ICONS.star
      const size = p.size ?? 40
      return (
        <div
          {...attributes}
          className={p.badge ? 'd-icon d-icon--badge' : 'd-icon'}
          style={{ justifyContent: justifyFor(p.align) }}
        >
          <span
            className='d-icon-glyph'
            style={{ width: size, height: size, color: resolveColor(p.color) }}
          >
            <IconSvg icon={entry.svg} />
          </span>
        </div>
      )
    },
  })

  const video = defineComponent<DocumentVideoProps>({
    type: 'video',
    label: 'Vídeo',
    icon: 'video',
    category: 'Mídia',
    keywords: ['vídeo', 'video', 'youtube', 'vimeo', 'apresentação'],
    propsSchema: documentVideoSchema,
    defaultProps: () => ({ url: '' }),
    accepts: false,
    inspector: [
      section('video', 'Vídeo', [
        {
          path: 'url',
          label: 'Link do vídeo',
          help: 'YouTube, Vimeo ou um arquivo .mp4. No PDF vira um link para assistir.',
          control: {
            kind: 'text',
            placeholder: 'https://youtu.be/…',
            maxLength: 2000,
          },
        },
        textField('title', 'Título (acessibilidade)', { maxLength: 500 }),
        textField('caption', 'Legenda', { maxLength: 500 }),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const source = videoSource(p.url)
      const caption = p.caption ? (
        <figcaption>{renderVars(p.caption, ctx)}</figcaption>
      ) : null
      const title = varsText(p.title, ctx) || 'Vídeo'
      if (source.kind === 'none') {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={Video01Icon}
            title='Vídeo'
            hint='Cole o link de um vídeo do YouTube ou do Vimeo.'
          />
        ) : null
      }
      if (ctx.mode === 'public') {
        return (
          <figure {...trackProps(ctx, 'video')} className='d-video'>
            <LiveVideo
              title={title}
              embedUrl={source.embedUrl}
              fileUrl={source.fileUrl}
              thumbnail={source.thumbnail}
            />
            {caption}
          </figure>
        )
      }
      const thumb = source.thumbnail ? (
        <img src={source.thumbnail} alt='' />
      ) : null
      const play = (
        <span className='d-video-play'>
          <span className='d-video-play-icon'>
            <IconSvg icon={PlayIcon} />
          </span>
          {print ? 'Assistir ao vídeo' : null}
        </span>
      )
      if (print) {
        const href = safeHref(p.url.trim())
        return (
          <figure {...trackProps(ctx, 'video')} className='d-video'>
            <a
              className='d-video-frame'
              href={href}
              target='_blank'
              rel='noopener noreferrer'
            >
              {thumb}
              {play}
            </a>
            {caption}
          </figure>
        )
      }
      return (
        <figure {...attributes} className='d-video'>
          <span className='d-video-frame'>
            {thumb}
            {play}
          </span>
          {caption}
        </figure>
      )
    },
  })

  const gallery = defineComponent<DocumentGalleryProps>({
    type: 'gallery',
    label: 'Galeria',
    icon: 'gallery',
    category: 'Mídia',
    keywords: ['galeria', 'fotos', 'imagens', 'portfólio', 'portfolio'],
    propsSchema: documentGallerySchema,
    defaultProps: () => ({ images: [], columns: 3, aspect: '4/3' }),
    accepts: false,
    inspector: [
      section('gallery', 'Galeria', [
        {
          path: 'images',
          label: 'Imagens',
          control: {
            kind: 'list',
            itemLabel: 'Imagem',
            max: 40,
            fields: [
              {
                path: 'src',
                label: 'Endereço da imagem',
                control: { kind: 'text', maxLength: 2000 },
              },
              textField('alt', 'Texto alternativo', { maxLength: 500 }),
              textField('caption', 'Legenda', { maxLength: 500 }),
            ],
          },
        },
        {
          path: 'columns',
          label: 'Colunas',
          control: { kind: 'number', min: 1, max: 4 },
        },
        {
          path: 'aspect',
          label: 'Formato',
          control: {
            kind: 'select',
            options: [
              { value: 'auto', label: 'Original' },
              { value: '1/1', label: 'Quadrado' },
              { value: '4/3', label: 'Paisagem (4:3)' },
              { value: '16/9', label: 'Widescreen (16:9)' },
            ],
          },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const images = p.images.filter((item) => safeSrc(item.src))
      if (images.length === 0) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={GalleryThumbnailsIcon}
            title='Galeria'
            hint='Adicione imagens no painel ao lado.'
          />
        ) : null
      }
      const aspect = p.aspect && p.aspect !== 'auto' ? p.aspect : undefined
      return (
        <div
          {...attributes}
          className='d-gallery'
          style={cssVars({ '--d-cols': p.columns ?? 3 })}
        >
          {images.map((item, index) => (
            <figure key={index}>
              <img
                src={safeSrc(item.src)}
                alt={varsText(item.alt, ctx)}
                style={{ aspectRatio: aspect }}
              />
              {item.caption ? (
                <figcaption>{renderVars(item.caption, ctx)}</figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      )
    },
  })

  const accordion = defineComponent<DocumentAccordionProps>({
    type: 'accordion',
    label: 'Perguntas frequentes',
    icon: 'accordion',
    category: 'Destaques',
    keywords: ['acordeão', 'acordeao', 'perguntas', 'faq', 'dúvidas'],
    propsSchema: documentAccordionSchema,
    defaultProps: () => ({ style: 'lines' }),
    accepts: ['accordion-item'],
    minChildren: 1,
    template: () => ({
      rootId: 'acc',
      nodes: {
        acc: {
          id: 'acc',
          type: 'accordion',
          props: { style: 'lines' },
          children: ['q1', 'q2'],
        },
        q1: {
          id: 'q1',
          type: 'accordion-item',
          props: { title: 'Qual é o prazo de implantação?', open: true },
          children: ['a1'],
        },
        a1: {
          id: 'a1',
          type: 'text',
          props: { html: '<p>Em média quatro semanas após o aceite.</p>' },
        },
        q2: {
          id: 'q2',
          type: 'accordion-item',
          props: { title: 'O suporte está incluído?' },
          children: ['a2'],
        },
        a2: {
          id: 'a2',
          type: 'text',
          props: {
            html: '<p>Sim, em horário comercial, por chat e e-mail.</p>',
          },
        },
      },
    }),
    inspector: [
      section('accordion', 'Perguntas', [
        {
          path: 'style',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'lines', label: 'Linhas' },
              { value: 'cards', label: 'Cartões' },
            ],
          },
        },
      ]),
    ],
    render: ({ node, attributes, children }) => (
      <div
        {...attributes}
        className={`d-acc d-acc--${node.props.style ?? 'lines'}`}
      >
        {children}
      </div>
    ),
  })

  const accordionItem = defineComponent<DocumentAccordionItemProps>({
    type: 'accordion-item',
    label: 'Pergunta',
    icon: 'accordion-item',
    propsSchema: documentAccordionItemSchema,
    defaultProps: () => ({ title: 'Nova pergunta' }),
    accepts: (type) => BLOCK_TYPE_SET.has(type) && type !== 'accordion',
    parents: ['accordion'],
    inlineText: { path: 'title', rich: false },
    inspector: [
      section('accordion-item', 'Pergunta', [
        textField('title', 'Pergunta', { rows: 2, maxLength: 500 }),
        toggleField('open', 'Começa aberta no link'),
      ]),
    ],
    render: ({ node, attributes, children }) => {
      const title = renderVars(node.props.title, ctx)
      if (ctx.mode === 'public') {
        return (
          <details className='d-acc-item' open={node.props.open === true}>
            <summary className='d-acc-summary'>{title}</summary>
            <div className='d-acc-body'>{children}</div>
          </details>
        )
      }
      return (
        <div {...attributes} className='d-acc-item'>
          <div className='d-acc-summary'>{title}</div>
          <div className='d-acc-body'>{children}</div>
        </div>
      )
    },
  })

  const stats = defineComponent<DocumentStatsProps>({
    type: 'stats',
    label: 'Números',
    icon: 'stats',
    category: 'Destaques',
    keywords: ['números', 'numeros', 'indicadores', 'resultados', 'métricas'],
    propsSchema: documentStatsSchema,
    defaultProps: () => ({
      style: 'cards',
      items: [
        { value: '+120', label: 'clientes atendidos' },
        { value: '98%', label: 'de satisfação' },
        { value: '24h', label: 'tempo médio de resposta' },
      ],
    }),
    accepts: false,
    inspector: [
      section('stats', 'Números', [
        {
          path: 'items',
          label: 'Indicadores',
          control: {
            kind: 'list',
            itemLabel: 'Indicador',
            max: 8,
            fields: [
              textField('value', 'Valor', { maxLength: 500 }),
              textField('label', 'Descrição', { maxLength: 500 }),
            ],
          },
        },
        {
          path: 'style',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'cards', label: 'Cartões' },
              { value: 'accent', label: 'Barra' },
              { value: 'plain', label: 'Simples' },
            ],
          },
        },
        alignField,
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const items = p.items.filter((item) => item.value || item.label)
      return (
        <div
          {...attributes}
          className={`d-stats d-stats--${p.style ?? 'plain'}`}
          style={cssVars({
            '--d-cols': Math.min(Math.max(items.length, 1), 4),
            textAlign: p.align,
          })}
        >
          {items.map((item, index) => (
            <div key={index} className='d-stat'>
              <span className='d-stat-value'>
                {renderVars(item.value, ctx)}
              </span>
              <span className='d-stat-label'>
                {renderVars(item.label, ctx)}
              </span>
            </div>
          ))}
        </div>
      )
    },
  })

  const testimonials = defineComponent<DocumentTestimonialsProps>({
    type: 'testimonials',
    label: 'Depoimentos',
    icon: 'testimonials',
    category: 'Destaques',
    keywords: ['depoimentos', 'clientes', 'avaliações', 'prova social'],
    propsSchema: documentTestimonialsSchema,
    defaultProps: () => ({
      items: [
        {
          quote:
            'A implantação foi rápida e o time esteve presente em cada etapa.',
          author: 'Ana Ribeiro',
          role: 'Diretora de Operações',
        },
        {
          quote:
            'Reduzimos pela metade o tempo de atendimento já no primeiro mês.',
          author: 'Carlos Mendes',
          role: 'Gerente de TI',
        },
      ],
    }),
    accepts: false,
    inspector: [
      section('testimonials', 'Depoimentos', [
        {
          path: 'items',
          label: 'Depoimentos',
          control: {
            kind: 'list',
            itemLabel: 'Depoimento',
            max: 12,
            fields: [
              textField('quote', 'Depoimento', { rows: 3, maxLength: 2000 }),
              textField('author', 'Nome', { maxLength: 500 }),
              textField('role', 'Cargo e empresa', { maxLength: 500 }),
              {
                path: 'photo',
                label: 'Foto (endereço)',
                control: { kind: 'text', maxLength: 2000 },
              },
            ],
          },
        },
        {
          path: 'columns',
          label: 'Colunas',
          control: { kind: 'number', min: 1, max: 3 },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const items = p.items.filter((item) => item.quote?.trim())
      const columns = p.columns ?? Math.min(Math.max(items.length, 1), 2)
      return (
        <div
          {...attributes}
          className='d-testimonials'
          style={cssVars({ '--d-cols': columns })}
        >
          {items.map((item, index) => {
            const author = varsText(item.author, ctx)
            const photo = safeSrc(item.photo)
            return (
              <figure key={index} className='d-testimonial'>
                <blockquote>“{renderVars(item.quote, ctx)}”</blockquote>
                {author ? (
                  <figcaption className='d-person'>
                    {photo ? (
                      <img className='d-avatar' src={photo} alt='' />
                    ) : (
                      <span className='d-avatar'>{initials(author)}</span>
                    )}
                    <span>
                      <strong>{author}</strong>
                      {item.role ? (
                        <span>{varsText(item.role, ctx)}</span>
                      ) : null}
                    </span>
                  </figcaption>
                ) : null}
              </figure>
            )
          })}
        </div>
      )
    },
  })

  const logos = defineComponent<DocumentLogosProps>({
    type: 'logos',
    label: 'Logos',
    icon: 'logos',
    category: 'Destaques',
    keywords: ['logos', 'clientes', 'parceiros', 'marcas'],
    propsSchema: documentLogosSchema,
    defaultProps: () => ({
      title: 'Empresas que confiam em nós',
      items: [],
      grayscale: true,
    }),
    accepts: false,
    inspector: [
      section('logos', 'Logos', [
        textField('title', 'Título', { maxLength: 500 }),
        {
          path: 'items',
          label: 'Logos',
          control: {
            kind: 'list',
            itemLabel: 'Logo',
            max: 24,
            fields: [
              {
                path: 'src',
                label: 'Endereço da imagem',
                control: { kind: 'text', maxLength: 2000 },
              },
              textField('alt', 'Nome da empresa', { maxLength: 500 }),
            ],
          },
        },
        {
          path: 'columns',
          label: 'Colunas',
          control: { kind: 'number', min: 2, max: 6 },
        },
        toggleField('grayscale', 'Em tons de cinza'),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const items = p.items.filter((item) => safeSrc(item.src))
      if (items.length === 0 && editing) {
        return (
          <Placeholder
            attributes={attributes}
            icon={Image01Icon}
            title={p.title || 'Logos'}
            hint='Adicione os logos no painel ao lado.'
          />
        )
      }
      if (items.length === 0) return null
      return (
        <div
          {...attributes}
          className={p.grayscale ? 'd-logos d-logos--gray' : 'd-logos'}
        >
          {p.title ? (
            <p className='d-logos-title'>{renderVars(p.title, ctx)}</p>
          ) : null}
          <div
            className='d-logos-grid'
            style={cssVars({
              '--d-cols': p.columns ?? Math.min(items.length, 5),
            })}
          >
            {items.map((item, index) => (
              <img key={index} src={safeSrc(item.src)} alt={item.alt ?? ''} />
            ))}
          </div>
        </div>
      )
    },
  })

  const toc = defineComponent<DocumentTocProps>({
    type: 'toc',
    label: 'Sumário',
    icon: 'toc',
    category: 'Destaques',
    keywords: ['sumário', 'sumario', 'índice', 'indice', 'seções'],
    propsSchema: documentTocSchema,
    defaultProps: () => ({ title: 'Sumário', numbered: true }),
    accepts: false,
    dependsOn: (doc) => {
      ctx.remember(doc)
      const entries = tocEntries(doc)
      return [entries.map((info) => `${info.id}:${info.name}`).join('|')]
    },
    inspector: [
      section('toc', 'Sumário', [
        textField('title', 'Título', { maxLength: 500 }),
        toggleField('numbered', 'Numerar as seções'),
        {
          path: 'columns',
          label: 'Colunas',
          control: { kind: 'number', min: 1, max: 2 },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const doc = ctx.getDocument()
      const entries = doc ? tocEntries(doc) : []
      return (
        <nav
          {...attributes}
          className={p.numbered === false ? 'd-toc' : 'd-toc d-toc--numbered'}
          style={cssVars({ '--d-cols': p.columns ?? 1 })}
          aria-label={p.title || 'Sumário'}
        >
          {p.title ? (
            <p className='d-toc-title'>{renderVars(p.title, ctx)}</p>
          ) : null}
          <ol>
            {entries.map((info) => (
              <li key={info.id}>
                <a href={`#d-sec-${info.id}`}>{varsText(info.name, ctx)}</a>
              </li>
            ))}
          </ol>
        </nav>
      )
    },
  })

  const contactCard = defineComponent<DocumentContactCardProps>({
    type: 'contact-card',
    label: 'Cartão de contato',
    icon: 'contact',
    category: 'Destaques',
    keywords: ['contato', 'responsável', 'vendedor', 'assinatura', 'cartão'],
    propsSchema: documentContactCardSchema,
    defaultProps: () => ({
      title: 'Seu contato',
      name: '{{responsavel.nome}}',
      role: 'Executivo de contas',
      company: '{{workspace.nome}}',
      email: '{{responsavel.email}}',
    }),
    accepts: false,
    inspector: [
      section('contact', 'Contato', [
        textField('title', 'Rótulo', { maxLength: 500 }),
        textField('name', 'Nome', { maxLength: 500, help: VARIABLES_HELP }),
        textField('role', 'Cargo', { maxLength: 500 }),
        textField('company', 'Empresa', { maxLength: 500 }),
        textField('email', 'E-mail', { maxLength: 500 }),
        textField('phone', 'Telefone', { maxLength: 500 }),
        {
          path: 'photo',
          label: 'Foto (endereço)',
          control: { kind: 'text', maxLength: 2000 },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const name = varsText(p.name, ctx)
      const email = varsText(p.email, ctx).trim()
      const phone = varsText(p.phone, ctx).trim()
      const photo = safeSrc(p.photo)
      const parts = [varsText(p.role, ctx), varsText(p.company, ctx)]
      const meta = parts.filter((part) => part.trim()).join(' · ')
      return (
        <div {...attributes} className='d-contact'>
          {photo ? (
            <img className='d-avatar' src={photo} alt='' />
          ) : (
            <span className='d-avatar'>{initials(name || '?')}</span>
          )}
          <div className='d-contact-body'>
            {p.title ? (
              <span className='d-contact-label'>
                {renderVars(p.title, ctx)}
              </span>
            ) : null}
            <span className='d-contact-name'>{name}</span>
            {meta ? <span className='d-contact-meta'>{meta}</span> : null}
            {email || phone ? (
              <span className='d-contact-links'>
                {email ? (
                  <a href={`mailto:${email}`} {...trackProps(ctx, 'link')}>
                    {email}
                  </a>
                ) : null}
                {phone ? (
                  <a
                    href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                    {...trackProps(ctx, 'link')}
                  >
                    {phone}
                  </a>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      )
    },
  })

  return [
    heading,
    text,
    list,
    quote,
    callout,
    table,
    button,
    image,
    icon,
    video,
    gallery,
    accordion,
    accordionItem,
    stats,
    testimonials,
    logos,
    toc,
    contactCard,
  ]
}

/** Header text as the stacked label of a cell on phones (no tags). */
function plainLabel(value: string | undefined): string | undefined {
  const text = (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  return text.trim() || undefined
}
