import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { SITE_TYPES } from '../constants'
import { type SiteRenderContext, siteLink } from '../context'
import { classNames } from '../css'
import { IconSvg, SITE_ICONS } from '../icons'
import {
  ALIGN_OPTIONS,
  ASPECT_RATIO_LABELS,
  advancedSection,
  boxSection,
  ICON_OPTIONS,
  SITE_LINK_TARGETS,
  spacingSection,
} from '../inspector'
import { safeHref, safeSrc, videoEmbedUrl } from '../sanitize'
import {
  ASPECT_RATIOS,
  type SiteEmbedProps,
  type SiteIconProps,
  type SiteImageProps,
  type SiteVideoProps,
  siteEmbedSchema,
  siteIconSchema,
  siteImageSchema,
  siteVideoSchema,
  VIDEO_RATIOS,
} from '../schemas'

const anchorId = (anchor: string | undefined) => anchor || undefined

function Placeholder({ label }: { label: string }) {
  return <div className='s-placeholder'>{label}</div>
}

// ─── image ────────────────────────────────────────────────────────────────

export function imageDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteImageProps>({
    type: SITE_TYPES.image,
    label: 'Imagem',
    icon: 'image',
    category: 'Mídia',
    keywords: ['foto', 'figura', 'logo', 'banner'],
    propsSchema: siteImageSchema,
    defaultProps: () => ({
      image: { src: '', alt: '' },
      width: { value: 100, unit: '%' },
      aspectRatio: 'auto',
      fit: 'cover',
      align: 'center',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Imagem',
        tab: 'content',
        fields: [
          { path: 'image', label: 'Imagem', control: { kind: 'image' } },
          {
            path: 'caption',
            label: 'Legenda',
            control: { kind: 'text', maxLength: 300 },
          },
          {
            path: 'link',
            label: 'Link',
            control: { kind: 'link', targets: SITE_LINK_TARGETS },
          },
          {
            path: 'priority',
            label: 'Carregar primeiro',
            help: 'Ligue só na imagem principal do topo da página.',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Tamanho',
        tab: 'style',
        fields: [
          {
            path: 'width',
            label: 'Largura',
            responsive: true,
            control: { kind: 'size', units: ['px', '%', 'auto'] },
          },
          {
            path: 'maxWidth',
            label: 'Largura máxima',
            responsive: true,
            control: { kind: 'size', units: ['auto', 'px', '%'] },
          },
          {
            path: 'aspectRatio',
            label: 'Proporção',
            responsive: true,
            control: {
              kind: 'select',
              options: ASPECT_RATIOS.map((value) => ({
                value,
                label: ASPECT_RATIO_LABELS[value],
              })),
            },
          },
          {
            path: 'fit',
            label: 'Preenchimento',
            control: {
              kind: 'segmented',
              options: [
                { value: 'cover', label: 'Cobrir' },
                { value: 'contain', label: 'Conter' },
              ],
            },
          },
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            control: { kind: 'segmented', options: ALIGN_OPTIONS },
          },
        ],
      },
      boxSection,
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SiteImageProps>) => {
      const p = node.props
      const src = safeSrc(p.image.src)
      if (!src && !editing) return null
      const link = siteLink(p.link, ctx)
      const img = src ? (
        <img
          className={link.href ? undefined : 's-media'}
          src={src}
          alt={p.image.alt}
          width={p.dimensions?.width}
          height={p.dimensions?.height}
          loading={p.priority ? 'eager' : 'lazy'}
          decoding={p.priority ? 'sync' : 'async'}
          fetchPriority={p.priority ? 'high' : undefined}
        />
      ) : (
        <Placeholder label='Escolha uma imagem no painel à direita' />
      )
      const media = link.href ? (
        <a {...link} className='s-media'>
          {img}
        </a>
      ) : (
        img
      )
      const className = classNames(node, 's-image')
      if (p.caption) {
        return (
          <figure {...attributes} id={anchorId(p.anchor)} className={className}>
            {media}
            <figcaption className='s-caption s-t-small'>{p.caption}</figcaption>
          </figure>
        )
      }
      return (
        <div {...attributes} id={anchorId(p.anchor)} className={className}>
          {media}
        </div>
      )
    },
  })
}

// ─── icon ─────────────────────────────────────────────────────────────────

export function iconDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteIconProps>({
    type: SITE_TYPES.icon,
    label: 'Ícone',
    icon: 'icon',
    category: 'Mídia',
    keywords: ['símbolo', 'pictograma', 'hugeicons'],
    propsSchema: siteIconSchema,
    defaultProps: () => ({
      name: 'rocket',
      size: 32,
      color: 'token:primary',
      shape: 'circle',
      background: 'token:surface',
      padding: 16,
      align: 'left',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Ícone',
        tab: 'content',
        fields: [
          {
            path: 'name',
            label: 'Ícone',
            control: { kind: 'select', options: ICON_OPTIONS },
          },
          {
            path: 'label',
            label: 'Descrição (acessibilidade)',
            help: 'Deixe vazio quando o ícone for só decorativo.',
            control: { kind: 'text', maxLength: 120 },
          },
          {
            path: 'link',
            label: 'Link',
            control: { kind: 'link', targets: SITE_LINK_TARGETS },
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
            control: { kind: 'number', min: 8, max: 256, unit: 'px' },
          },
          {
            path: 'color',
            label: 'Cor',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'shape',
            label: 'Fundo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'none', label: 'Nenhum' },
                { value: 'circle', label: 'Círculo' },
                { value: 'square', label: 'Quadrado' },
              ],
            },
          },
          {
            path: 'background',
            label: 'Cor do fundo',
            showIf: (props) => props.shape !== 'none',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'padding',
            label: 'Respiro',
            showIf: (props) => props.shape !== 'none',
            control: { kind: 'number', min: 0, max: 100, unit: 'px' },
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
    render: ({ node, attributes }: CanvasRenderProps<SiteIconProps>) => {
      const p = node.props
      const link = siteLink(p.link, ctx)
      const svg = (
        <IconSvg icon={SITE_ICONS[p.name].svg} label={p.label || undefined} />
      )
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-icon')}
        >
          {link.href ? (
            <a {...link} className='s-icon-box'>
              {svg}
            </a>
          ) : (
            <span className='s-icon-box'>{svg}</span>
          )}
        </div>
      )
    },
  })
}

// ─── video ────────────────────────────────────────────────────────────────

export const videoDefinition = defineComponent<SiteVideoProps>({
  type: SITE_TYPES.video,
  label: 'Vídeo',
  icon: 'video',
  category: 'Mídia',
  keywords: ['youtube', 'vimeo', 'mp4', 'filme'],
  propsSchema: siteVideoSchema,
  defaultProps: () => ({
    source: 'youtube',
    url: '',
    title: 'Vídeo',
    aspectRatio: '16/9',
    autoplay: false,
    muted: false,
    loop: false,
    controls: true,
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Vídeo',
      tab: 'content',
      fields: [
        {
          path: 'source',
          label: 'Origem',
          control: {
            kind: 'segmented',
            options: [
              { value: 'youtube', label: 'YouTube' },
              { value: 'vimeo', label: 'Vimeo' },
              { value: 'upload', label: 'Arquivo' },
            ],
          },
        },
        {
          path: 'url',
          label: 'Endereço do vídeo',
          control: { kind: 'text', placeholder: 'https://…' },
        },
        {
          path: 'poster',
          label: 'Imagem de capa (URL)',
          showIf: { path: 'source', equals: 'upload' },
          control: { kind: 'text', placeholder: 'https://…/capa.jpg' },
        },
        {
          path: 'title',
          label: 'Título (acessibilidade)',
          control: { kind: 'text', maxLength: 200 },
        },
        {
          path: 'autoplay',
          label: 'Reproduzir sozinho',
          control: { kind: 'toggle' },
        },
        { path: 'muted', label: 'Sem som', control: { kind: 'toggle' } },
        { path: 'loop', label: 'Repetir', control: { kind: 'toggle' } },
        {
          path: 'controls',
          label: 'Mostrar controles',
          control: { kind: 'toggle' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Tamanho',
      tab: 'style',
      fields: [
        {
          path: 'aspectRatio',
          label: 'Proporção',
          control: {
            kind: 'select',
            options: VIDEO_RATIOS.map((value) => ({
              value,
              label: ASPECT_RATIO_LABELS[value],
            })),
          },
        },
        {
          path: 'width',
          label: 'Largura',
          responsive: true,
          control: { kind: 'size', units: ['px', '%', 'fill'] },
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
  }: CanvasRenderProps<SiteVideoProps>) => {
    const p = node.props
    const autoplay = p.autoplay && !editing
    let player = null
    if (p.source === 'upload') {
      const src = safeSrc(p.url)
      player = src ? (
        <video
          src={src}
          poster={safeSrc(p.poster)}
          title={p.title}
          controls={p.controls}
          autoPlay={autoplay}
          // Browsers only autoplay muted videos.
          muted={p.muted || autoplay}
          loop={p.loop}
          playsInline
          preload={autoplay ? 'auto' : 'none'}
        />
      ) : null
    } else {
      const src = videoEmbedUrl(p.source, p.url, {
        autoplay,
        muted: p.muted || autoplay,
        loop: p.loop,
        controls: p.controls,
      })
      player = src ? (
        <iframe
          src={src}
          title={p.title || 'Vídeo'}
          loading='lazy'
          allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
          allowFullScreen
          referrerPolicy='strict-origin-when-cross-origin'
          className={editing ? 's-embed-preview' : undefined}
        />
      ) : null
    }
    if (!player && !editing) return null
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-video')}
      >
        {player ? (
          <div className='s-video-frame'>{player}</div>
        ) : (
          <Placeholder label='Cole o endereço de um vídeo do YouTube ou Vimeo, ou envie um arquivo' />
        )}
      </div>
    )
  },
})

// ─── embed ────────────────────────────────────────────────────────────────

/** Sandbox of `site.embed`: scripts run in an opaque origin (no access to
 * the site's cookies or DOM); forms and popups allowed for widgets. */
export const EMBED_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'

export function embedDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteEmbedProps>({
    type: SITE_TYPES.embed,
    label: 'Código incorporado',
    icon: 'embed',
    // Admins only: arbitrary third-party markup.
    category: ctx.canEmbed ? 'Avançado' : undefined,
    keywords: ['html', 'iframe', 'widget', 'script', 'mapa'],
    propsSchema: siteEmbedSchema,
    defaultProps: () => ({
      mode: 'url',
      html: '',
      url: '',
      height: 400,
      title: 'Conteúdo incorporado',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Incorporar',
        tab: 'content',
        fields: [
          {
            path: 'mode',
            label: 'Tipo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'url', label: 'Endereço' },
                { value: 'html', label: 'HTML' },
              ],
            },
          },
          {
            path: 'url',
            label: 'Endereço (https)',
            showIf: { path: 'mode', equals: 'url' },
            control: { kind: 'text', placeholder: 'https://…' },
          },
          {
            path: 'html',
            label: 'Código HTML',
            help: 'Roda isolado do site, numa moldura protegida.',
            showIf: { path: 'mode', equals: 'html' },
            control: { kind: 'textarea', rows: 8, maxLength: 50000 },
          },
          {
            path: 'title',
            label: 'Título (acessibilidade)',
            control: { kind: 'text', maxLength: 200 },
          },
          {
            path: 'height',
            label: 'Altura',
            responsive: true,
            control: { kind: 'number', min: 40, max: 4000, unit: 'px' },
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
    }: CanvasRenderProps<SiteEmbedProps>) => {
      const p = node.props
      const url = safeHref(p.url)
      const source =
        p.mode === 'html'
          ? p.html.trim()
            ? { srcDoc: p.html }
            : null
          : url?.startsWith('https://')
            ? { src: url }
            : null
      if (!source && !editing) return null
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-embed')}
        >
          {source ? (
            <iframe
              {...source}
              title={p.title || 'Conteúdo incorporado'}
              sandbox={EMBED_SANDBOX}
              loading='lazy'
              referrerPolicy='no-referrer'
              className={editing ? 's-embed-preview' : undefined}
            />
          ) : (
            <Placeholder label='Informe um endereço https ou cole o código HTML' />
          )}
        </div>
      )
    },
  })
}
