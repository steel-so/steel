import {
  MapsLocation01Icon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import { SITE_TYPES } from '../constants'
import type { SiteRenderContext } from '../context'
import { classNames } from '../css'
import { IconSvg } from '../icons'
import { ALIGN_OPTIONS, advancedSection, spacingSection } from '../inspector'
import {
  type SiteMapProps,
  type SiteWhatsappProps,
  siteMapSchema,
  siteWhatsappSchema,
} from '../schemas'

/**
 * Contact elements of the site catalog (phase S2): a privacy-friendly map
 * (Google Maps embed by address, loaded only after a click unless the
 * site owner opts out) and the WhatsApp button (floating or inline).
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

// ─── map ──────────────────────────────────────────────────────────────────

/** Google Maps embed and "open in Maps" URLs of an address. */
export function mapUrls(address: string, zoom: number) {
  const query = encodeURIComponent(address.trim())
  return {
    embed: `https://www.google.com/maps?q=${query}&z=${zoom}&output=embed`,
    open: `https://www.google.com/maps/search/?api=1&query=${query}`,
  }
}

export const mapDefinition = defineComponent<SiteMapProps>({
  type: SITE_TYPES.map,
  label: 'Mapa',
  icon: 'map',
  category: 'Contato',
  keywords: ['endereço', 'localização', 'google maps', 'como chegar'],
  propsSchema: siteMapSchema,
  defaultProps: () => ({
    address: 'Avenida Paulista, 1000, São Paulo, SP',
    zoom: 15,
    height: { base: 400, mobile: 300 },
    loadOnClick: true,
    title: 'Mapa com a nossa localização',
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Mapa',
      tab: 'content',
      fields: [
        {
          path: 'address',
          label: 'Endereço',
          control: { kind: 'textarea', rows: 2, maxLength: 300 },
        },
        {
          path: 'zoom',
          label: 'Aproximação',
          help: 'De 1 (mundo) a 20 (rua).',
          control: { kind: 'number', min: 1, max: 20 },
        },
        {
          path: 'loadOnClick',
          label: 'Carregar só ao clicar',
          help: 'Recomendado (LGPD): o Google só recebe dados de quem pedir para ver o mapa, e a página carrega mais rápido.',
          control: { kind: 'toggle' },
        },
        {
          path: 'title',
          label: 'Descrição (acessibilidade)',
          control: { kind: 'text', maxLength: 200 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Tamanho',
      tab: 'style',
      fields: [
        {
          path: 'height',
          label: 'Altura',
          responsive: true,
          control: { kind: 'number', min: 120, max: 1600, unit: 'px' },
        },
        { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({ node, attributes, editing }: CanvasRenderProps<SiteMapProps>) => {
    const p = node.props
    if (!p.address.trim() && !editing) return null
    const urls = mapUrls(p.address, p.zoom)
    const title = p.title || 'Mapa'
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-map')}
      >
        <div className='s-map-frame'>
          {!p.loadOnClick && !editing ? (
            <iframe
              src={urls.embed}
              title={title}
              loading='lazy'
              referrerPolicy='no-referrer-when-downgrade'
              allowFullScreen
            />
          ) : (
            <div className='s-map-placeholder'>
              <IconSvg icon={MapsLocation01Icon} />
              <p className='s-map-address'>
                {p.address || 'Informe o endereço no painel à direita'}
              </p>
              <button
                type='button'
                className='s-btn s-btn-primary s-btn-sm'
                data-s-map-load={editing ? undefined : urls.embed}
                data-title={editing ? undefined : title}
                tabIndex={editing ? -1 : undefined}
              >
                Carregar mapa
              </button>
              <p className='s-map-note'>
                Ao carregar, o Google Maps recebe dados da sua visita.{' '}
                <a href={urls.open} target='_blank' rel='noopener noreferrer'>
                  Abrir no Google Maps
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    )
  },
})

// ─── whatsapp ─────────────────────────────────────────────────────────────

/** `https://wa.me/<digits>` with the starting message; `null` without a
 * number. */
export function whatsappHref(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const text = message.trim()
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function whatsappDefinition(ctx: SiteRenderContext) {
  const phoneField: InspectorField = ctx.whatsappPicker
    ? {
        path: 'phone',
        label: 'Número do WhatsApp',
        control: { kind: 'custom', component: ctx.whatsappPicker },
      }
    : {
        path: 'phone',
        label: 'Número do WhatsApp',
        help: 'Com DDI e DDD, ex.: +55 11 91234-5678.',
        control: {
          kind: 'text',
          placeholder: '+55 11 91234-5678',
          maxLength: 30,
        },
      }
  return defineComponent<SiteWhatsappProps>({
    type: SITE_TYPES.whatsapp,
    label: 'Botão do WhatsApp',
    icon: 'whatsapp',
    category: 'Contato',
    keywords: ['zap', 'whatsapp', 'conversar', 'chat', 'atendimento'],
    propsSchema: siteWhatsappSchema,
    defaultProps: () => ({
      phone: '',
      message: 'Olá! Vim pelo site e gostaria de mais informações.',
      mode: 'floating',
      side: 'right',
      label: 'Fale no WhatsApp',
      showLabel: false,
      size: 'md',
      color: '#25D366',
      textColor: '#ffffff',
      align: 'left',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'WhatsApp',
        tab: 'content',
        fields: [
          phoneField,
          {
            path: 'message',
            label: 'Mensagem inicial',
            control: { kind: 'textarea', rows: 3, maxLength: 500 },
          },
          {
            path: 'mode',
            label: 'Tipo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'floating', label: 'Flutuante' },
                { value: 'inline', label: 'Na página' },
              ],
            },
          },
          {
            path: 'side',
            label: 'Canto da tela',
            showIf: { path: 'mode', equals: 'floating' },
            control: {
              kind: 'segmented',
              options: [
                { value: 'right', label: 'Direito' },
                { value: 'left', label: 'Esquerdo' },
              ],
            },
          },
          {
            path: 'label',
            label: 'Texto',
            control: { kind: 'text', maxLength: 60 },
          },
          {
            path: 'showLabel',
            label: 'Mostrar o texto no botão flutuante',
            showIf: { path: 'mode', equals: 'floating' },
            control: { kind: 'toggle' },
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
            control: {
              kind: 'segmented',
              options: [
                { value: 'md', label: 'M' },
                { value: 'lg', label: 'G' },
              ],
            },
          },
          {
            path: 'color',
            label: 'Cor do botão',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'textColor',
            label: 'Cor do ícone e texto',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            showIf: { path: 'mode', equals: 'inline' },
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
    }: CanvasRenderProps<SiteWhatsappProps>) => {
      const p = node.props
      const href = whatsappHref(p.phone, p.message)
      if (!href && !editing) return null
      const floating = p.mode === 'floating'
      const iconOnly = floating && !p.showLabel
      const label = p.label || 'Fale no WhatsApp'
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(
            node,
            's-wa',
            `s-wa-${p.mode}`,
            floating && `s-wa-${p.side}`,
            p.size === 'lg' && 's-wa-lg',
            iconOnly && 's-wa-icon',
          )}
        >
          <a
            className='s-wa-btn'
            href={href ?? undefined}
            target='_blank'
            rel='noopener noreferrer'
            aria-label={iconOnly ? label : undefined}
          >
            <IconSvg icon={WhatsappIcon} />
            {!iconOnly && <span>{label}</span>}
          </a>
        </div>
      )
    },
  })
}
