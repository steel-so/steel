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
  BUTTON_VARIANT_OPTIONS,
  SITE_LINK_TARGETS,
  spacingSection,
} from '../inspector'
import { safeSrc } from '../sanitize'
import {
  ASPECT_RATIOS,
  type SiteCountdownProps,
  type SiteGalleryProps,
  type SiteLogosProps,
  type SitePricingProps,
  type SiteStatsProps,
  type SiteTestimonialsProps,
  siteCountdownSchema,
  siteGallerySchema,
  siteLogosSchema,
  sitePricingSchema,
  siteStatsSchema,
  siteTestimonialsSchema,
  UTC_OFFSETS,
} from '../schemas'
import { CarouselControls, carouselData } from './interactive'

/**
 * Showcase elements of the site catalog (phase S2): gallery, testimonials,
 * pricing table, logo strip, statistics and countdown. Leaves edited from
 * the inspector (item lists), rendered as lists/figures with their final
 * content so they read well without JavaScript and to search engines.
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

function Placeholder({ label }: { label: string }) {
  return <div className='s-placeholder'>{label}</div>
}

const PRESET_IMG = '/landing-page-templates'

const columnsField = (max: number, label = 'Colunas') => ({
  path: 'columns',
  label,
  responsive: true,
  control: { kind: 'number' as const, min: 1, max },
})

const gapField = (label = 'Espaço entre itens') => ({
  path: 'gap',
  label,
  responsive: true,
  control: { kind: 'number' as const, min: 0, max: 400, unit: 'px' },
})

const cardFields = [
  { path: 'radius', label: 'Cantos', control: { kind: 'radius' as const } },
  { path: 'border', label: 'Borda', control: { kind: 'border' as const } },
  { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' as const } },
]

// ─── gallery ──────────────────────────────────────────────────────────────

export function galleryDefinition() {
  return defineComponent<SiteGalleryProps>({
    type: SITE_TYPES.gallery,
    label: 'Galeria',
    icon: 'gallery',
    category: 'Mídia',
    keywords: ['fotos', 'imagens', 'portfólio', 'mosaico', 'lightbox'],
    propsSchema: siteGallerySchema,
    defaultProps: () => ({
      items: [
        { image: { src: `${PRESET_IMG}/agency/work-1.png`, alt: 'Projeto 1' } },
        { image: { src: `${PRESET_IMG}/agency/work-2.png`, alt: 'Projeto 2' } },
        { image: { src: `${PRESET_IMG}/agency/work-3.png`, alt: 'Projeto 3' } },
        { image: { src: `${PRESET_IMG}/agency/work-4.png`, alt: 'Projeto 4' } },
      ],
      layout: 'grid',
      columns: { base: 3, tablet: 2, mobile: 1 },
      gap: { base: 16, mobile: 12 },
      aspectRatio: '4/3',
      fit: 'cover',
      lightbox: true,
      showCaptions: false,
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Fotos',
        tab: 'content',
        fields: [
          {
            path: 'items',
            label: 'Fotos',
            control: {
              kind: 'list',
              itemLabel: 'Foto',
              max: 60,
              fields: [
                { path: 'image', label: 'Imagem', control: { kind: 'image' } },
                {
                  path: 'caption',
                  label: 'Legenda',
                  control: { kind: 'text', maxLength: 300 },
                },
              ],
            },
          },
          {
            path: 'lightbox',
            label: 'Ampliar ao clicar',
            help: 'Abre as fotos em tela cheia, com setas para navegar.',
            control: { kind: 'toggle' },
          },
          {
            path: 'showCaptions',
            label: 'Mostrar legendas',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Layout',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'Disposição',
            control: {
              kind: 'segmented',
              options: [
                { value: 'grid', label: 'Grade' },
                { value: 'masonry', label: 'Mosaico' },
              ],
            },
          },
          columnsField(6),
          gapField(),
          {
            path: 'aspectRatio',
            label: 'Proporção',
            showIf: { path: 'layout', equals: 'grid' },
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
            showIf: { path: 'layout', equals: 'grid' },
            control: {
              kind: 'segmented',
              options: [
                { value: 'cover', label: 'Cobrir' },
                { value: 'contain', label: 'Conter' },
              ],
            },
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
    }: CanvasRenderProps<SiteGalleryProps>) => {
      const p = node.props
      const items = p.items
        .map((item) => ({ ...item, src: safeSrc(item.image.src) }))
        .filter((item) => item.src)
      if (items.length === 0) {
        return editing ? (
          <div {...attributes}>
            <Placeholder label='Adicione fotos no painel à direita' />
          </div>
        ) : null
      }
      const zoom = p.lightbox && !editing
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-gallery', `s-gallery-${p.layout}`)}
          data-s-gallery={zoom ? '' : undefined}
        >
          <ul className='s-gallery-list'>
            {items.map((item, index) => {
              const img = (
                <img
                  src={item.src}
                  alt={item.image.alt}
                  loading='lazy'
                  decoding='async'
                />
              )
              return (
                <li key={index} className='s-gallery-item'>
                  <figure>
                    {zoom ? (
                      <a
                        href={item.src}
                        className='s-gallery-link'
                        data-s-lightbox=''
                        data-caption={item.caption || undefined}
                        aria-label={`Ampliar ${item.image.alt || `foto ${index + 1}`}`}
                      >
                        {img}
                      </a>
                    ) : (
                      img
                    )}
                    {p.showCaptions && item.caption && (
                      <figcaption>{item.caption}</figcaption>
                    )}
                  </figure>
                </li>
              )
            })}
          </ul>
        </div>
      )
    },
  })
}

// ─── testimonials ─────────────────────────────────────────────────────────

const STAR =
  'M12 2.8l2.83 5.73 6.33.92-4.58 4.47 1.08 6.3L12 17.25l-5.66 2.97 1.08-6.3-4.58-4.47 6.33-.92z'

function Stars({ value }: { value: number }) {
  return (
    <div className='s-stars' role='img' aria-label={`${value} de 5 estrelas`}>
      {[0, 1, 2, 3, 4].map((index) => (
        <svg
          key={index}
          viewBox='0 0 24 24'
          aria-hidden='true'
          focusable='false'
        >
          <path
            d={STAR}
            fill={index < value ? 'currentColor' : 'none'}
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinejoin='round'
          />
        </svg>
      ))}
    </div>
  )
}

export const testimonialsDefinition = defineComponent<SiteTestimonialsProps>({
  type: SITE_TYPES.testimonials,
  label: 'Depoimentos',
  icon: 'testimonials',
  category: 'Vendas',
  keywords: ['avaliações', 'clientes', 'opiniões', 'prova social', 'review'],
  propsSchema: siteTestimonialsSchema,
  defaultProps: () => ({
    items: [
      {
        quote:
          'Atendimento impecável do começo ao fim. Recomendo de olhos fechados.',
        name: 'Fernanda Lima',
        role: 'Diretora de marketing',
        avatar: {
          src: `${PRESET_IMG}/agency/testimonial-avatar-1.png`,
          alt: '',
        },
        rating: 5,
      },
      {
        quote: 'Processo claro e resultado acima do esperado.',
        name: 'Ricardo Alves',
        role: 'Sócio-fundador',
        avatar: { src: `${PRESET_IMG}/b2b/testimonial-avatar-2.png`, alt: '' },
        rating: 5,
      },
      {
        quote: 'O melhor parceiro que já tivemos. Equipe atenta e rápida.',
        name: 'Juliana Rocha',
        role: 'Gerente comercial',
        avatar: { src: `${PRESET_IMG}/b2b/testimonial-avatar-3.png`, alt: '' },
        rating: 5,
      },
    ],
    layout: 'grid',
    columns: { base: 3, tablet: 2, mobile: 1 },
    gap: 24,
    align: 'left',
    showRating: true,
    showAvatar: true,
    autoplay: false,
    interval: 6,
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Depoimentos',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Depoimentos',
          control: {
            kind: 'list',
            itemLabel: 'Depoimento',
            max: 24,
            fields: [
              {
                path: 'quote',
                label: 'Depoimento',
                control: { kind: 'textarea', rows: 3, maxLength: 1000 },
              },
              {
                path: 'name',
                label: 'Nome',
                control: { kind: 'text', maxLength: 120 },
              },
              {
                path: 'role',
                label: 'Cargo ou empresa',
                control: { kind: 'text', maxLength: 160 },
              },
              { path: 'avatar', label: 'Foto', control: { kind: 'image' } },
              {
                path: 'rating',
                label: 'Estrelas',
                control: { kind: 'number', min: 0, max: 5 },
              },
            ],
          },
        },
        {
          path: 'layout',
          label: 'Exibir em',
          control: {
            kind: 'segmented',
            options: [
              { value: 'grid', label: 'Grade' },
              { value: 'slider', label: 'Carrossel' },
            ],
          },
        },
        {
          path: 'autoplay',
          label: 'Passar sozinho',
          showIf: { path: 'layout', equals: 'slider' },
          control: { kind: 'toggle' },
        },
        {
          path: 'interval',
          label: 'Tempo por depoimento',
          showIf: (props) => props.layout === 'slider' && !!props.autoplay,
          control: { kind: 'number', min: 2, max: 30, unit: 's' },
        },
        {
          path: 'showRating',
          label: 'Mostrar estrelas',
          control: { kind: 'toggle' },
        },
        {
          path: 'showAvatar',
          label: 'Mostrar fotos',
          control: { kind: 'toggle' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Cartões',
      tab: 'style',
      fields: [
        columnsField(4, 'Colunas (ou visíveis no carrossel)'),
        gapField(),
        {
          path: 'align',
          label: 'Alinhamento',
          control: {
            kind: 'segmented',
            options: ALIGN_OPTIONS.filter((option) => option.value !== 'right'),
          },
        },
        {
          path: 'cardBackground',
          label: 'Fundo dos cartões',
          control: { kind: 'color', allowTokens: true, allowTransparent: true },
        },
        {
          path: 'starColor',
          label: 'Cor das estrelas',
          control: { kind: 'color', allowTokens: true },
        },
        ...cardFields,
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({
    node,
    attributes,
    editing,
  }: CanvasRenderProps<SiteTestimonialsProps>) => {
    const p = node.props
    if (p.items.length === 0) {
      return editing ? (
        <div {...attributes}>
          <Placeholder label='Adicione depoimentos no painel à direita' />
        </div>
      ) : null
    }
    const slider = p.layout === 'slider'
    const cards = p.items.map((item, index) => {
      const avatar = p.showAvatar ? safeSrc(item.avatar?.src) : undefined
      return (
        <li key={index}>
          <figure className='s-tm-card'>
            {p.showRating && (item.rating ?? 0) > 0 && (
              <Stars value={item.rating ?? 0} />
            )}
            <blockquote className='s-tm-quote'>
              <p>{item.quote}</p>
            </blockquote>
            <figcaption className='s-tm-author'>
              {avatar && (
                <img
                  className='s-tm-avatar'
                  src={avatar}
                  alt=''
                  width={48}
                  height={48}
                  loading='lazy'
                  decoding='async'
                />
              )}
              <span>
                <span className='s-tm-name'>{item.name}</span>
                {item.role && <span className='s-tm-role'>{item.role}</span>}
              </span>
            </figcaption>
          </figure>
        </li>
      )
    })
    const list = (
      <ul className={slider ? 's-tm-list s-carousel-track' : 's-tm-list'}>
        {cards}
      </ul>
    )
    if (!slider) {
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-testimonials')}
        >
          {list}
        </div>
      )
    }
    return (
      <section
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-testimonials', 's-carousel')}
        aria-roledescription='carrossel'
        aria-label='Depoimentos'
        {...carouselData(editing, p.autoplay, p.interval, true)}
      >
        {list}
        <CarouselControls
          count={p.items.length}
          arrows
          dots
          autoplay={p.autoplay}
        />
      </section>
    )
  },
})

// ─── pricing ──────────────────────────────────────────────────────────────

export function pricingDefinition(ctx: SiteRenderContext) {
  return defineComponent<SitePricingProps>({
    type: SITE_TYPES.pricing,
    label: 'Tabela de preços',
    icon: 'pricing',
    category: 'Vendas',
    keywords: ['planos', 'preços', 'assinatura', 'valores', 'pacotes'],
    propsSchema: sitePricingSchema,
    defaultProps: () => ({
      plans: [
        {
          name: 'Essencial',
          price: 'R$ 49',
          period: '/mês',
          description: 'Para quem está começando.',
          features: '1 usuário\nSite com até 5 páginas\nSuporte por e-mail',
          buttonLabel: 'Começar',
          link: { type: 'anchor', value: 'contato' },
        },
        {
          name: 'Profissional',
          price: 'R$ 129',
          period: '/mês',
          description: 'Para equipes em crescimento.',
          features:
            '5 usuários\nPáginas ilimitadas\nFormulários no CRM\nSuporte prioritário',
          highlighted: true,
          badge: 'Mais escolhido',
          buttonLabel: 'Assinar agora',
          link: { type: 'anchor', value: 'contato' },
        },
        {
          name: 'Empresa',
          price: 'R$ 299',
          period: '/mês',
          description: 'Para operações maiores.',
          features:
            'Usuários ilimitados\nDomínio próprio\nGerente de conta\nSLA de atendimento',
          buttonLabel: 'Falar com vendas',
          link: { type: 'anchor', value: 'contato' },
        },
      ],
      columns: { base: 3, tablet: 3, mobile: 1 },
      gap: 24,
      align: 'left',
      buttonVariant: 'outline',
      highlightButtonVariant: 'secondary',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Planos',
        tab: 'content',
        fields: [
          {
            path: 'plans',
            label: 'Planos',
            control: {
              kind: 'list',
              itemLabel: 'Plano',
              max: 6,
              fields: [
                {
                  path: 'name',
                  label: 'Nome',
                  control: { kind: 'text', maxLength: 80 },
                },
                {
                  path: 'price',
                  label: 'Preço',
                  control: {
                    kind: 'text',
                    maxLength: 40,
                    placeholder: 'R$ 99',
                  },
                },
                {
                  path: 'period',
                  label: 'Período',
                  control: {
                    kind: 'text',
                    maxLength: 40,
                    placeholder: '/mês',
                  },
                },
                {
                  path: 'description',
                  label: 'Descrição',
                  control: { kind: 'textarea', rows: 2, maxLength: 300 },
                },
                {
                  path: 'features',
                  label: 'Itens (um por linha)',
                  control: { kind: 'textarea', rows: 5, maxLength: 3000 },
                },
                {
                  path: 'highlighted',
                  label: 'Destacar',
                  control: { kind: 'toggle' },
                },
                {
                  path: 'badge',
                  label: 'Selo',
                  control: {
                    kind: 'text',
                    maxLength: 40,
                    placeholder: 'Mais escolhido',
                  },
                },
                {
                  path: 'buttonLabel',
                  label: 'Texto do botão',
                  control: { kind: 'text', maxLength: 80 },
                },
                {
                  path: 'link',
                  label: 'Link do botão',
                  control: { kind: 'link', targets: SITE_LINK_TARGETS },
                },
              ],
            },
          },
        ],
      },
      {
        id: 'style',
        label: 'Cartões',
        tab: 'style',
        fields: [
          columnsField(4),
          gapField(),
          {
            path: 'align',
            label: 'Alinhamento',
            control: {
              kind: 'segmented',
              options: ALIGN_OPTIONS.filter(
                (option) => option.value !== 'right',
              ),
            },
          },
          {
            path: 'buttonVariant',
            label: 'Botão dos planos',
            control: { kind: 'select', options: BUTTON_VARIANT_OPTIONS },
          },
          {
            path: 'highlightButtonVariant',
            label: 'Botão do plano destacado',
            control: { kind: 'select', options: BUTTON_VARIANT_OPTIONS },
          },
          {
            path: 'cardBackground',
            label: 'Fundo dos cartões',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'highlightBackground',
            label: 'Fundo do destaque',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'highlightText',
            label: 'Texto do destaque',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'checkColor',
            label: 'Cor dos ícones',
            control: { kind: 'color', allowTokens: true },
          },
          ...cardFields,
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({ node, attributes }: CanvasRenderProps<SitePricingProps>) => {
      const p = node.props
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-pricing')}
        >
          <ul className='s-pricing-list'>
            {p.plans.map((plan, index) => {
              const link = siteLink(plan.link, ctx)
              const variant = plan.highlighted
                ? p.highlightButtonVariant
                : p.buttonVariant
              const features = plan.features
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
              return (
                <li
                  key={index}
                  className={plan.highlighted ? 's-plan s-plan-hl' : 's-plan'}
                >
                  {plan.badge && (
                    <span className='s-plan-badge'>{plan.badge}</span>
                  )}
                  <h3 className='s-plan-name s-t-h5'>
                    {plan.name || `Plano ${index + 1}`}
                  </h3>
                  <p className='s-plan-price'>
                    <span className='s-plan-amount'>{plan.price}</span>
                    {plan.period && (
                      <span className='s-plan-period'>{plan.period}</span>
                    )}
                  </p>
                  {plan.description && (
                    <p className='s-plan-desc'>{plan.description}</p>
                  )}
                  {features.length > 0 && (
                    <ul className='s-plan-features'>
                      {features.map((feature, line) => (
                        <li key={line}>
                          <IconSvg icon={SITE_ICONS.check.svg} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.buttonLabel &&
                    (link.href ? (
                      <a {...link} className={`s-btn s-btn-${variant}`}>
                        {plan.buttonLabel}
                      </a>
                    ) : (
                      <span className={`s-btn s-btn-${variant}`}>
                        {plan.buttonLabel}
                      </span>
                    ))}
                </li>
              )
            })}
          </ul>
        </div>
      )
    },
  })
}

// ─── logos ────────────────────────────────────────────────────────────────

const LOGO_FILES = [
  'logo-askimat.png',
  'logo-coworks.png',
  'logo-dorfus.png',
  'logo-greener.png',
  'logo-makeless.png',
  'logo-saastoday.png',
]

export function logosDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteLogosProps>({
    type: SITE_TYPES.logos,
    label: 'Logos',
    icon: 'logos',
    category: 'Vendas',
    keywords: ['marcas', 'clientes', 'parceiros', 'logotipos', 'carrossel'],
    propsSchema: siteLogosSchema,
    defaultProps: () => ({
      items: LOGO_FILES.map((file) => ({
        image: {
          src: `${PRESET_IMG}/job-site/${file}`,
          alt: file.replace('logo-', '').replace('.png', ''),
        },
      })),
      mode: 'marquee',
      columns: { base: 6, tablet: 3, mobile: 2 },
      height: { base: 36, mobile: 28 },
      gap: { base: 56, mobile: 32 },
      speed: 30,
      grayscale: true,
      align: 'center',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Logos',
        tab: 'content',
        fields: [
          {
            path: 'items',
            label: 'Logos',
            control: {
              kind: 'list',
              itemLabel: 'Logo',
              max: 30,
              fields: [
                { path: 'image', label: 'Imagem', control: { kind: 'image' } },
                {
                  path: 'link',
                  label: 'Link',
                  control: { kind: 'link', targets: SITE_LINK_TARGETS },
                },
              ],
            },
          },
          {
            path: 'mode',
            label: 'Exibir em',
            control: {
              kind: 'segmented',
              options: [
                { value: 'marquee', label: 'Faixa rolando' },
                { value: 'grid', label: 'Grade' },
              ],
            },
          },
          {
            path: 'speed',
            label: 'Tempo de uma volta',
            showIf: { path: 'mode', equals: 'marquee' },
            control: { kind: 'number', min: 5, max: 180, unit: 's' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Logos',
        tab: 'style',
        fields: [
          {
            path: 'height',
            label: 'Altura dos logos',
            responsive: true,
            control: { kind: 'number', min: 12, max: 240, unit: 'px' },
          },
          { ...columnsField(8), showIf: { path: 'mode', equals: 'grid' } },
          gapField(),
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            showIf: { path: 'mode', equals: 'grid' },
            control: { kind: 'segmented', options: ALIGN_OPTIONS },
          },
          {
            path: 'grayscale',
            label: 'Tons de cinza (cor ao passar o mouse)',
            control: { kind: 'toggle' },
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
    }: CanvasRenderProps<SiteLogosProps>) => {
      const p = node.props
      const items = p.items
        .map((item) => ({ ...item, src: safeSrc(item.image.src) }))
        .filter((item) => item.src)
      if (items.length === 0) {
        return editing ? (
          <div {...attributes}>
            <Placeholder label='Adicione logos no painel à direita' />
          </div>
        ) : null
      }
      const list = (copy: boolean) => (
        <ul className='s-logos-list' aria-hidden={copy ? 'true' : undefined}>
          {items.map((item, index) => {
            const img = (
              <img
                src={item.src}
                alt={copy ? '' : item.image.alt}
                loading='lazy'
                decoding='async'
              />
            )
            const link = siteLink(item.link, ctx)
            return (
              <li key={index}>
                {link.href ? (
                  <a {...link} tabIndex={copy ? -1 : undefined}>
                    {img}
                  </a>
                ) : (
                  img
                )}
              </li>
            )
          })}
        </ul>
      )
      const marquee = p.mode === 'marquee'
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-logos', marquee && 's-logos-marquee')}
        >
          {marquee ? (
            <div className='s-marquee-track'>
              {list(false)}
              {list(true)}
            </div>
          ) : (
            list(false)
          )}
        </div>
      )
    },
  })
}

// ─── stats ────────────────────────────────────────────────────────────────

export function formatStat(value: number, decimals = 0): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export const statsDefinition = defineComponent<SiteStatsProps>({
  type: SITE_TYPES.stats,
  label: 'Números',
  icon: 'stats',
  category: 'Vendas',
  keywords: ['estatísticas', 'contador', 'resultados', 'métricas', 'kpi'],
  propsSchema: siteStatsSchema,
  defaultProps: () => ({
    items: [
      { value: 1200, prefix: '+', label: 'clientes atendidos' },
      { value: 98, suffix: '%', label: 'de satisfação' },
      { value: 15, label: 'anos de mercado' },
      { value: 4.9, decimals: 1, label: 'nota média' },
    ],
    columns: { base: 4, tablet: 2, mobile: 2 },
    gap: { base: 32, mobile: 24 },
    align: 'center',
    numberSize: { base: 48, mobile: 36 },
    numberColor: 'token:primary',
    animate: true,
    duration: 1600,
    dividers: false,
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Números',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Números',
          control: {
            kind: 'list',
            itemLabel: 'Número',
            max: 12,
            fields: [
              {
                path: 'label',
                label: 'Legenda',
                control: { kind: 'text', maxLength: 160 },
              },
              {
                path: 'value',
                label: 'Valor',
                control: { kind: 'number', min: -1e12, max: 1e12 },
              },
              {
                path: 'decimals',
                label: 'Casas decimais',
                control: { kind: 'number', min: 0, max: 3 },
              },
              {
                path: 'prefix',
                label: 'Antes do número',
                control: { kind: 'text', maxLength: 12, placeholder: '+' },
              },
              {
                path: 'suffix',
                label: 'Depois do número',
                control: { kind: 'text', maxLength: 12, placeholder: '%' },
              },
            ],
          },
        },
        {
          path: 'animate',
          label: 'Contar ao aparecer',
          help: 'Os números sobem do zero quando entram na tela (não para quem pede menos movimento).',
          control: { kind: 'toggle' },
        },
        {
          path: 'duration',
          label: 'Duração da contagem',
          showIf: { path: 'animate', equals: true },
          control: {
            kind: 'number',
            min: 300,
            max: 8000,
            step: 100,
            unit: 'ms',
          },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        columnsField(6),
        gapField(),
        {
          path: 'align',
          label: 'Alinhamento',
          responsive: true,
          control: { kind: 'segmented', options: ALIGN_OPTIONS },
        },
        {
          path: 'numberSize',
          label: 'Tamanho dos números',
          responsive: true,
          control: { kind: 'number', min: 16, max: 160, unit: 'px' },
        },
        {
          path: 'numberColor',
          label: 'Cor dos números',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'labelColor',
          label: 'Cor das legendas',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'dividers',
          label: 'Linhas entre os números',
          control: { kind: 'toggle' },
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
  }: CanvasRenderProps<SiteStatsProps>) => {
    const p = node.props
    const count = p.animate && !editing
    return (
      <ul
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(node, 's-stats', p.dividers && 's-stats-divided')}
        data-s-stats={count ? '' : undefined}
        data-duration={count ? p.duration : undefined}
      >
        {p.items.map((item, index) => {
          const value = item.value ?? 0
          return (
            <li key={index} className='s-stat'>
              <span
                className='s-stat-num'
                data-s-count={count ? value : undefined}
                data-decimals={
                  count && item.decimals ? item.decimals : undefined
                }
                data-prefix={count ? item.prefix || undefined : undefined}
                data-suffix={count ? item.suffix || undefined : undefined}
              >
                {`${item.prefix ?? ''}${formatStat(value, item.decimals)}${item.suffix ?? ''}`}
              </span>
              <span className='s-stat-label'>{item.label}</span>
            </li>
          )
        })}
      </ul>
    )
  },
})

// ─── countdown ────────────────────────────────────────────────────────────

const UNIT_LABELS = {
  d: 'dias',
  h: 'horas',
  m: 'minutos',
  s: 'segundos',
} as const
type CountdownUnit = keyof typeof UNIT_LABELS

const UNITS: Record<SiteCountdownProps['units'], CountdownUnit[]> = {
  dhms: ['d', 'h', 'm', 's'],
  dhm: ['d', 'h', 'm'],
  hms: ['h', 'm', 's'],
}

/** A week from now (`YYYY-MM-DD`), the date a new countdown starts with. */
export function inAWeek(now = Date.now()): string {
  return new Date(now + 7 * 86_400_000).toISOString().slice(0, 10)
}

/** Instant the countdown ends (`null` without a date). */
export function countdownEnd(p: SiteCountdownProps): string | null {
  if (!p.date) return null
  return `${p.date}T${p.time || '00:00'}:00${p.offset}`
}

/** Remaining time split into units (the largest unit takes the rest). */
export function countdownParts(
  ms: number,
  units: CountdownUnit[],
): Record<CountdownUnit, number> {
  let rest = Math.max(0, Math.floor(ms / 1000))
  const out = { d: 0, h: 0, m: 0, s: 0 }
  const size = { d: 86400, h: 3600, m: 60, s: 1 }
  for (const unit of units) {
    out[unit] = Math.floor(rest / size[unit])
    rest -= out[unit] * size[unit]
  }
  return out
}

export const countdownDefinition = defineComponent<SiteCountdownProps>({
  type: SITE_TYPES.countdown,
  label: 'Contagem regressiva',
  icon: 'countdown',
  category: 'Vendas',
  keywords: ['contador', 'timer', 'cronômetro', 'lançamento', 'oferta'],
  propsSchema: siteCountdownSchema,
  defaultProps: () => ({
    date: inAWeek(),
    time: '23:59',
    offset: '-03:00',
    units: 'dhms',
    showLabels: true,
    style: 'boxes',
    expiredText: 'A oferta terminou.',
    size: { base: 48, mobile: 32 },
    align: 'center',
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Contagem',
      tab: 'content',
      fields: [
        {
          path: 'date',
          label: 'Data final',
          help: 'No formato AAAA-MM-DD, ex.: 2026-12-31.',
          control: { kind: 'text', placeholder: '2026-12-31', maxLength: 10 },
        },
        {
          path: 'time',
          label: 'Horário final',
          control: { kind: 'text', placeholder: '23:59', maxLength: 5 },
        },
        {
          path: 'offset',
          label: 'Fuso horário',
          control: {
            kind: 'select',
            options: UTC_OFFSETS.map((value) => ({
              value,
              label:
                value === '-03:00'
                  ? 'Brasília (UTC−3)'
                  : `UTC${value.replace('-', '−')}`,
            })),
          },
        },
        {
          path: 'units',
          label: 'Mostrar',
          control: {
            kind: 'segmented',
            options: [
              { value: 'dhms', label: 'Dias a segundos' },
              { value: 'dhm', label: 'Dias a minutos' },
              { value: 'hms', label: 'Horas a segundos' },
            ],
          },
        },
        {
          path: 'expiredText',
          label: 'Texto ao terminar',
          control: { kind: 'text', maxLength: 200 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'style',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'boxes', label: 'Caixas' },
              { value: 'plain', label: 'Simples' },
            ],
          },
        },
        {
          path: 'showLabels',
          label: 'Legendas',
          control: { kind: 'toggle' },
        },
        {
          path: 'size',
          label: 'Tamanho dos números',
          responsive: true,
          control: { kind: 'number', min: 16, max: 160, unit: 'px' },
        },
        {
          path: 'align',
          label: 'Alinhamento',
          responsive: true,
          control: { kind: 'segmented', options: ALIGN_OPTIONS },
        },
        {
          path: 'numberColor',
          label: 'Cor dos números',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'labelColor',
          label: 'Cor das legendas',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'boxBackground',
          label: 'Fundo das caixas',
          showIf: { path: 'style', equals: 'boxes' },
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
  }: CanvasRenderProps<SiteCountdownProps>) => {
    const p = node.props
    const end = countdownEnd(p)
    const endMs = end ? Date.parse(end) : Number.NaN
    if (Number.isNaN(endMs) && !editing) return null
    const remaining = Number.isNaN(endMs) ? 0 : endMs - Date.now()
    const units = UNITS[p.units]
    const parts = countdownParts(remaining, units)
    const className = classNames(node, 's-countdown', `s-countdown-${p.style}`)
    if (end && remaining <= 0 && !editing) {
      return (
        <div {...attributes} id={anchorId(p.anchor)} className={className}>
          <p className='s-cd-expired'>{p.expiredText}</p>
        </div>
      )
    }
    return (
      <div
        {...attributes}
        id={anchorId(p.anchor)}
        className={className}
        role='timer'
        aria-label='Contagem regressiva'
        data-s-countdown={editing || !end ? undefined : end}
        data-expired={editing ? undefined : p.expiredText}
      >
        {units.map((unit) => (
          <div key={unit} className='s-cd-unit'>
            <span className='s-cd-num' data-unit={unit}>
              {String(parts[unit]).padStart(2, '0')}
            </span>
            {p.showLabels && (
              <span className='s-cd-label'>{UNIT_LABELS[unit]}</span>
            )}
          </div>
        ))}
      </div>
    )
  },
})
