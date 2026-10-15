import { spacing } from '@/src/lib/canvas/values'
import type { SiteIconName } from '../icons'
import {
  anchor,
  box,
  button,
  divider,
  form,
  grid,
  heading,
  icon,
  image,
  list,
  menu,
  type NodeSpec,
  named,
  overline,
  row,
  section,
  social,
  text,
  url,
} from './builder'
import type { SiteKit } from './kits'

/**
 * The 15 section types of the landing pages (hero, services, facts, about,
 * testimonial, features, works, footer, pricing, faq, steps, newsletter,
 * logos, products, header), rebuilt as site fragments. Each builder takes
 * a kit (visual style) and returns the section spec; copy is pt-BR and
 * images come from the kits' public assets.
 */

export const SITE_SECTION_TYPES = [
  'header',
  'hero',
  'logos',
  'services',
  'features',
  'about',
  'facts',
  'steps',
  'works',
  'products',
  'testimonial',
  'pricing',
  'faq',
  'newsletter',
  'footer',
] as const
export type SiteSectionType = (typeof SITE_SECTION_TYPES)[number]

export const SITE_SECTION_LABELS: Record<SiteSectionType, string> = {
  header: 'Cabeçalho',
  hero: 'Destaque principal',
  logos: 'Logos de clientes',
  services: 'Serviços',
  features: 'Diferenciais',
  about: 'Sobre',
  facts: 'Números',
  steps: 'Como funciona',
  works: 'Portfólio',
  products: 'Produtos',
  testimonial: 'Depoimentos',
  pricing: 'Planos e preços',
  faq: 'Perguntas frequentes',
  newsletter: 'Newsletter',
  footer: 'Rodapé',
}

const IMG = '/landing-page-templates'

const BRAND = 'Aurora'

const BAND_PADDING = {
  base: spacing(112, 24),
  tablet: spacing(88, 24),
  mobile: spacing(64, 20),
}

export function band(kit: SiteKit, tinted = false) {
  return {
    background: tinted ? kit.band : { kind: 'none' as const },
    padding: BAND_PADDING,
    gap: { base: 56, mobile: 40 },
  }
}

/** Overline + title (+ intro), aligned by the kit. */
export function head(
  kit: SiteKit,
  eyebrow: string,
  title: string,
  intro?: string,
): NodeSpec {
  const align = kit.headAlign
  return box(
    {
      maxWidth: { value: 760, unit: 'px' },
      alignItems: align === 'center' ? 'center' : 'start',
      textAlign: align,
      gap: 16,
    },
    [
      overline(eyebrow, { align, color: kit.overline }),
      heading('h2', title, { align }),
      ...(intro
        ? [text(intro, { preset: 'lead', align, color: 'token:muted' })]
        : []),
    ],
  )
}

export function centered(kit: SiteKit) {
  return kit.headAlign === 'center' ? ('center' as const) : ('stretch' as const)
}

export function card(
  kit: SiteKit,
  children: NodeSpec[],
  extra: Record<string, unknown> = {},
): NodeSpec {
  return box(
    {
      background: kit.card.background,
      radius: kit.card.radius,
      shadow: kit.card.shadow,
      border: kit.card.border,
      padding: { base: spacing(40, 32), mobile: spacing(32, 24) },
      gap: 16,
      ...extra,
    },
    children,
  )
}

function chip(kit: SiteKit, name: SiteIconName, index: number): NodeSpec {
  return icon(name, {
    size: 28,
    shape: kit.id === 'b2b' ? 'square' : 'circle',
    padding: 18,
    color: 'token:inverse',
    background: kit.chips[index % kit.chips.length],
    align: kit.headAlign === 'center' && kit.id !== 'saas' ? 'center' : 'left',
  })
}

function logo(inverse = false): NodeSpec {
  return named(
    'Logo',
    text(`<p><strong>${BRAND}</strong></p>`, {
      preset: 'lead',
      color: inverse ? 'token:inverse' : 'token:text',
      typography: { fontSize: 24, fontWeight: 700, letterSpacing: -0.5 },
    }),
  )
}

const NAV = [
  { label: 'Serviços', link: anchor('servicos') },
  { label: 'Sobre', link: anchor('sobre') },
  { label: 'Depoimentos', link: anchor('depoimentos') },
  { label: 'Contato', link: anchor('contato') },
]

// ─── header ───────────────────────────────────────────────────────────────

export function headerSection(kit: SiteKit): NodeSpec {
  const inverse = kit.id === 'saas'
  return named(
    'Cabeçalho',
    section(
      {
        tag: 'header',
        background:
          kit.id === 'saas'
            ? kit.hero
            : { kind: 'color', color: 'token:background' },
        textColor: inverse ? 'token:inverse' : undefined,
        padding: { base: spacing(20, 24), mobile: spacing(14, 20) },
        border:
          kit.id === 'b2b'
            ? { width: 1, style: 'solid', color: 'token:border' }
            : undefined,
      },
      [
        row(
          [
            logo(inverse),
            box(
              {
                grow: true,
                direction: 'row',
                justify: 'end',
                alignItems: 'center',
                gap: 24,
              },
              [
                menu({
                  source: 'custom',
                  items: NAV,
                  justify: kit.id === 'b2b' ? 'center' : 'end',
                  color: inverse ? 'token:inverse' : 'token:text',
                  hoverColor: inverse ? 'token:inverse' : 'token:primary',
                }),
                button('Fale conosco', anchor('contato'), {
                  variant: inverse ? 'secondary' : 'primary',
                  size: 'sm',
                  visibility: { base: true, tablet: true, mobile: false },
                }),
              ],
            ),
          ],
          { justify: 'between', wrap: false },
        ),
      ],
    ),
  )
}

// ─── hero ─────────────────────────────────────────────────────────────────

export function heroSection(kit: SiteKit): NodeSpec {
  const cta = button('Comece seu projeto', anchor('contato'), { size: 'lg' })
  if (kit.id === 'saas') {
    return named(
      'Destaque principal',
      section(
        {
          background: kit.hero,
          textColor: kit.heroText,
          padding: { base: spacing(120, 24), mobile: spacing(72, 20) },
          contentAlign: 'center',
          gap: 32,
        },
        [
          box(
            {
              maxWidth: { value: 820, unit: 'px' },
              alignItems: 'center',
              gap: 24,
              textAlign: 'center',
            },
            [
              heading(
                'h1',
                'Organize, automatize e cresça com um só aplicativo',
                { align: 'center' },
              ),
              text(
                'Tudo o que sua equipe precisa para vender e atender melhor, num lugar só. Teste grátis por 14 dias, sem cartão.',
                {
                  preset: 'lead',
                  align: 'center',
                  color: '#ffffffcc',
                },
              ),
              row(
                [
                  button('Testar grátis', anchor('planos'), {
                    variant: 'secondary',
                    size: 'lg',
                  }),
                  button('Ver como funciona', anchor('como-funciona'), {
                    variant: 'outline',
                    size: 'lg',
                    textColor: 'token:inverse',
                    borderColor: '#ffffff66',
                  }),
                ],
                { justify: 'center' },
              ),
            ],
          ),
          image(
            `${IMG}/saas-subscription/hero-mockup.png`,
            'Tela do aplicativo com o painel de vendas',
            {
              maxWidth: { value: 960, unit: 'px' },
              radius: kit.photo,
              priority: true,
              shadow: {
                x: 0,
                y: 40,
                blur: 80,
                spread: -20,
                color: '#00000059',
              },
            },
          ),
        ],
      ),
    )
  }
  const b2b = kit.id === 'b2b'
  return named(
    'Destaque principal',
    section(
      {
        background: kit.hero,
        padding: {
          base: spacing(104, 24),
          tablet: spacing(80, 24),
          mobile: spacing(56, 20),
        },
      },
      [
        grid(
          2,
          [
            box({ gap: 24, alignItems: 'start' }, [
              ...(b2b
                ? []
                : [
                    overline('Vamos transformar o seu negócio', {
                      color: kit.overline,
                    }),
                  ]),
              heading(
                'h1',
                b2b
                  ? 'Torne sua empresa mais forte com a gente.'
                  : 'Faça seu negócio crescer rápido com a Aurora.',
              ),
              text(
                'Estratégia, design e tecnologia trabalhando juntos para tirar suas ideias do papel em poucas semanas.',
                {
                  preset: 'lead',
                  color: 'token:muted',
                  maxWidth: { value: 520, unit: 'px' },
                },
              ),
              row([
                cta,
                ...(b2b
                  ? [
                      button('Veja como ajudamos', anchor('sobre'), {
                        variant: 'link',
                        icon: 'play',
                        iconPosition: 'start',
                      }),
                    ]
                  : []),
              ]),
            ]),
            image(
              b2b
                ? `${IMG}/b2b/hero-portrait.png`
                : `${IMG}/agency/hero-portrait.png`,
              'Profissional sorrindo em reunião de projeto',
              {
                aspectRatio: { base: '3/4', tablet: '4/3', mobile: '4/3' },
                maxWidth: { value: 480, unit: 'px' },
                radius: kit.photo,
                priority: true,
                align: 'right',
              },
            ),
          ],
          { alignItems: 'center', gap: { base: 64, mobile: 40 } },
          1,
        ),
      ],
    ),
  )
}

// ─── logos ────────────────────────────────────────────────────────────────

const LOGOS = [
  'askimat',
  'coworks',
  'dorfus',
  'greener',
  'makeless',
  'saastoday',
]

export function logosSection(kit: SiteKit): NodeSpec {
  return named(
    'Logos de clientes',
    section(
      {
        ...band(kit, kit.id === 'b2b'),
        padding: { base: spacing(56, 24), mobile: spacing(40, 20) },
        gap: 32,
      },
      [
        text('Empresas que já crescem com a gente', {
          preset: 'small',
          align: kit.headAlign === 'left' ? 'left' : 'center',
          color: 'token:muted',
        }),
        grid(
          6,
          LOGOS.map((name) =>
            image(
              `${IMG}/job-site/logo-${name}.png`,
              `Logo da ${name.charAt(0).toUpperCase()}${name.slice(1)}`,
              {
                maxWidth: { value: 150, unit: 'px' },
                fit: 'contain',
              },
            ),
          ),
          { alignItems: 'center', gap: { base: 40, mobile: 24 } },
          3,
          2,
        ),
      ],
    ),
  )
}

// ─── services ─────────────────────────────────────────────────────────────

const SERVICES: Array<[SiteIconName, string, string]> = [
  [
    'brush',
    'Design gráfico',
    'Identidade visual, materiais e peças que fazem sua marca ser lembrada.',
  ],
  [
    'code',
    'Desenvolvimento web',
    'Sites e sistemas rápidos, acessíveis e prontos para vender mais.',
  ],
  [
    'message',
    'Conteúdo e redação',
    'Textos que explicam seu valor com clareza e convertem visitantes.',
  ],
]

export function servicesSection(kit: SiteKit): NodeSpec {
  return named(
    'Serviços',
    section(
      {
        ...band(kit, kit.id !== 'b2b'),
        anchor: 'servicos',
        contentAlign: centered(kit),
      },
      [
        head(
          kit,
          'Nossos serviços',
          'Serviços pensados para cada etapa do seu crescimento',
        ),
        grid(
          3,
          SERVICES.map(([name, title, body], index) =>
            card(
              kit,
              [
                chip(kit, name, index),
                heading('h3', title, {
                  preset: 'h4',
                  align:
                    kit.headAlign === 'center' && kit.id === 'agency'
                      ? 'center'
                      : 'left',
                }),
                text(body, {
                  color: 'token:muted',
                  align:
                    kit.headAlign === 'center' && kit.id === 'agency'
                      ? 'center'
                      : 'left',
                }),
                button('Saiba mais', anchor('contato'), {
                  variant: 'link',
                  icon: 'arrow',
                  align: kit.id === 'agency' ? 'center' : 'left',
                }),
              ],
              { alignItems: 'stretch' },
            ),
          ),
          {},
          kit.id === 'b2b' ? 1 : 2,
        ),
      ],
    ),
  )
}

// ─── features ─────────────────────────────────────────────────────────────

const FEATURES: Array<[SiteIconName, string, string]> = [
  [
    'users',
    'Gerente de projeto dedicado',
    'Uma pessoa acompanha seu projeto do começo ao fim.',
  ],
  [
    'layers',
    'Tarefas organizadas',
    'Cada entrega tem prazo, responsável e status à vista.',
  ],
  [
    'message',
    'Feedback sem ruído',
    'Comente direto nas telas e veja tudo virar ajuste.',
  ],
  [
    'clock',
    'Prazo é compromisso',
    'Cronograma realista e combinado antes de começar.',
  ],
]

export function featuresSection(kit: SiteKit): NodeSpec {
  const items = FEATURES.map(([name, title, body], index) => {
    if (kit.id === 'agency') {
      return box({ direction: 'row', gap: 20, alignItems: 'start' }, [
        icon(name, {
          size: 24,
          shape: 'circle',
          padding: 14,
          color: 'token:primary',
          background: 'token:surface',
        }),
        box({ gap: 8, grow: true }, [
          heading('h3', title, { preset: 'h5' }),
          text(body, { color: 'token:muted' }),
        ]),
      ])
    }
    if (kit.id === 'saas') {
      return card(kit, [
        chip(kit, name, index),
        heading('h3', title, { preset: 'h5' }),
        text(body, { color: 'token:muted' }),
      ])
    }
    return box({ gap: 12, padding: spacing(0) }, [
      icon(name, { size: 32, shape: 'none', color: 'token:primary' }),
      heading('h3', title, { preset: 'h5' }),
      text(body, { color: 'token:muted' }),
    ])
  })
  return named(
    'Diferenciais',
    section({ ...band(kit, kit.id === 'saas'), contentAlign: centered(kit) }, [
      head(
        kit,
        'Por que nos escolher',
        'Quem trabalha com a gente recebe o melhor de nós',
      ),
      grid(
        kit.id === 'agency' ? 2 : 4,
        items,
        { gap: { base: 40, mobile: 32 } },
        2,
      ),
    ]),
  )
}

// ─── about ────────────────────────────────────────────────────────────────

export function aboutSection(kit: SiteKit): NodeSpec {
  const photo = image(
    kit.id === 'b2b'
      ? `${IMG}/b2b/content01-photo.png`
      : `${IMG}/agency/about-photo-main.png`,
    'Equipe reunida discutindo um projeto',
    { aspectRatio: { base: '4/3', mobile: '3/2' }, radius: kit.photo },
  )
  const copy = box({ gap: 20, alignItems: 'start' }, [
    overline('Nossa história', { color: kit.overline }),
    heading(
      'h2',
      'Sabemos o que faz um negócio dar certo — e o que o faz travar.',
    ),
    text(
      'Há mais de dez anos ajudamos empresas a organizar processos, comunicar melhor e vender mais. Juntamos estratégia e execução no mesmo time.',
      { color: 'token:muted' },
    ),
    list([
      'Diagnóstico antes de qualquer proposta',
      'Time sênior em todas as entregas',
      'Resultados medidos todo mês',
    ]),
    button('Conheça a equipe', anchor('contato'), {
      variant: kit.id === 'b2b' ? 'secondary' : 'primary',
    }),
  ])
  const children = kit.id === 'b2b' ? [copy, photo] : [photo, copy]
  return named(
    'Sobre',
    section({ ...band(kit, kit.id === 'saas'), anchor: 'sobre' }, [
      grid(
        2,
        children,
        { alignItems: 'center', gap: { base: 72, tablet: 48, mobile: 32 } },
        1,
      ),
    ]),
  )
}

// ─── facts ────────────────────────────────────────────────────────────────

const FACTS = [
  ['1 mi+', 'visitas por mês nos sites que criamos'],
  ['92%', 'dos clientes renovam o contrato'],
  ['4,9/5', 'de nota média nas avaliações'],
]

export function factsSection(kit: SiteKit): NodeSpec {
  const inverse = kit.id === 'b2b'
  const items = FACTS.map(([value, label]) => {
    const content = [
      heading('h3', value, {
        preset: 'h2',
        align: kit.id === 'b2b' ? 'left' : 'center',
        color: inverse ? 'token:inverse' : 'token:primary',
      }),
      text(label, {
        align: kit.id === 'b2b' ? 'left' : 'center',
        color: inverse ? undefined : 'token:muted',
      }),
    ]
    return kit.id === 'saas'
      ? card(kit, content, { gap: 8 })
      : box({ gap: 8 }, content)
  })
  return named(
    'Números',
    section(
      {
        background: inverse ? kit.dark : kit.band,
        textColor: inverse ? 'token:inverse' : undefined,
        padding: { base: spacing(88, 24), mobile: spacing(56, 20) },
        gap: 40,
      },
      [grid(3, items, { gap: { base: 40, mobile: 32 } }, 3)],
    ),
  )
}

// ─── steps ────────────────────────────────────────────────────────────────

const STEPS = [
  [
    'Conversa inicial',
    'Entendemos seu momento, seus objetivos e o que já foi tentado.',
  ],
  [
    'Plano sob medida',
    'Você recebe um plano com etapas, prazos e investimento claros.',
  ],
  [
    'Execução e resultado',
    'Colocamos em prática e acompanhamos os números com você.',
  ],
]

export function stepsSection(kit: SiteKit): NodeSpec {
  const items = STEPS.map(([title, body], index) => {
    const number = text(`0${index + 1}`, {
      preset: 'lead',
      color: kit.chips[index % kit.chips.length],
      typography: { fontSize: 40, fontWeight: 700, lineHeight: 1 },
      align: kit.headAlign,
    })
    const content = [
      number,
      heading('h3', title, { preset: 'h4', align: kit.headAlign }),
      text(body, { color: 'token:muted', align: kit.headAlign }),
    ]
    return kit.id === 'b2b'
      ? box(
          {
            gap: 12,
            padding: { base: spacing(24, 0), mobile: spacing(16, 0) },
            border: undefined,
          },
          [divider({ margin: spacing(0) }), ...content],
        )
      : card(kit, content, { gap: 12 })
  })
  return named(
    'Como funciona',
    section(
      {
        ...band(kit, kit.id !== 'saas'),
        anchor: 'como-funciona',
        contentAlign: centered(kit),
      },
      [
        head(
          kit,
          'Como funciona',
          'Do primeiro contato ao resultado em três passos',
        ),
        grid(3, items, {}, 3),
      ],
    ),
  )
}

// ─── works ────────────────────────────────────────────────────────────────

const WORKS = [
  ['work-1', 'Identidade Aura', 'Design gráfico'],
  ['work-3', 'Embalagens AB.S', 'Design gráfico'],
  ['work-2', 'Site Gradiente', 'Desenvolvimento web'],
  ['work-4', 'Revista Conteúdo', 'Conteúdo e redação'],
]

export function worksSection(kit: SiteKit): NodeSpec {
  const columns = kit.id === 'b2b' ? 4 : 2
  return named(
    'Portfólio',
    section({ ...band(kit, kit.id === 'saas'), contentAlign: centered(kit) }, [
      head(kit, 'Cases', 'Projetos que mostram por que somos referência'),
      grid(
        columns,
        WORKS.map(([file, title, category]) =>
          box({ gap: 12 }, [
            image(`${IMG}/agency/${file}.png`, `Projeto ${title}`, {
              aspectRatio: '4/3',
              radius: kit.photo,
            }),
            text(category, { preset: 'overline', color: 'token:muted' }),
            heading('h3', title, { preset: 'h5' }),
          ]),
        ),
        {},
        2,
      ),
      button('Ver todos os projetos', anchor('contato'), {
        variant: 'outline',
        align: kit.headAlign === 'center' ? 'center' : 'left',
      }),
    ]),
  )
}

// ─── products ─────────────────────────────────────────────────────────────

const PRODUCTS = [
  ['product-armen-living-chair', 'Poltrona Armen', 'R$ 1.290'],
  ['product-kingso-round-table', 'Mesa redonda Kingso', 'R$ 2.150'],
  ['product-knight-chair', 'Cadeira Knight', 'R$ 640'],
  ['product-rivet-accent-chair', 'Poltrona Rivet', 'R$ 1.480'],
]

export function productsSection(kit: SiteKit): NodeSpec {
  return named(
    'Produtos',
    section(
      { ...band(kit, kit.id === 'agency'), contentAlign: centered(kit) },
      [
        head(kit, 'Mais vendidos', 'Escolhidos a dedo para o seu espaço'),
        grid(
          4,
          PRODUCTS.map(([file, title, price]) =>
            card(
              kit,
              [
                image(`${IMG}/ecommerce/${file}.png`, title, {
                  aspectRatio: '1/1',
                  fit: 'contain',
                  radius: kit.photo,
                }),
                heading('h3', title, { preset: 'h6' }),
                text(price, {
                  preset: 'lead',
                  color: 'token:primary',
                  typography: { fontWeight: 700 },
                }),
                button('Comprar', anchor('contato'), {
                  size: 'sm',
                  align: 'stretch',
                }),
              ],
              { padding: spacing(20), gap: 12 },
            ),
          ),
          { gap: { base: 24, mobile: 20 } },
          2,
        ),
      ],
    ),
  )
}

// ─── testimonial ──────────────────────────────────────────────────────────

const QUOTES = [
  [
    'Ganhamos um site novo em poucas semanas, fácil de editar e que já trouxe mais contatos no primeiro mês.',
    'Fernanda Lima',
    'Diretora de marketing',
    'agency/testimonial-avatar-1.png',
  ],
  [
    'Processo claro do começo ao fim. A equipe entendeu nosso negócio e entregou acima do esperado.',
    'Ricardo Alves',
    'Sócio-fundador',
    'b2b/testimonial-avatar-2.png',
  ],
  [
    'Simplesmente o melhor parceiro que já tivemos. Recomendo para quem quer crescer com segurança.',
    'Juliana Rocha',
    'Gerente comercial',
    'b2b/testimonial-avatar-3.png',
  ],
]

function author(
  name: string,
  role: string,
  avatar: string,
  align: 'left' | 'center',
): NodeSpec {
  return box(
    {
      direction: 'row',
      gap: 14,
      alignItems: 'center',
      justify: align === 'center' ? 'center' : 'start',
    },
    [
      image(`${IMG}/${avatar}`, `Foto de ${name}`, {
        width: { value: 56, unit: 'px' },
        aspectRatio: '1/1',
        radius: {
          topLeft: 999,
          topRight: 999,
          bottomRight: 999,
          bottomLeft: 999,
        },
        align: 'left',
      }),
      box({ gap: 2 }, [
        text(`<p><strong>${name}</strong></p>`, { preset: 'body' }),
        text(role, { preset: 'small', color: 'token:muted' }),
      ]),
    ],
  )
}

export function testimonialSection(kit: SiteKit): NodeSpec {
  if (kit.id === 'b2b') {
    return named(
      'Depoimentos',
      section({ ...band(kit, true), anchor: 'depoimentos' }, [
        head(kit, 'Depoimentos', 'O que nossos clientes dizem'),
        grid(
          3,
          QUOTES.map(([quote, name, role, avatar]) =>
            card(
              kit,
              [
                icon('quote', {
                  size: 32,
                  shape: 'none',
                  color: 'token:primary',
                }),
                text(quote, { preset: 'body' }),
                author(name, role, avatar, 'left'),
              ],
              { justify: 'between', gap: 24 },
            ),
          ),
          {},
          1,
        ),
      ]),
    )
  }
  const [quote, name, role, avatar] = QUOTES[0]
  const content = [
    icon('quote', {
      size: 40,
      shape: 'none',
      color: kit.overline,
      align: 'center',
    }),
    text(`<p>“${quote}”</p>`, {
      preset: 'lead',
      align: 'center',
      typography: {
        base: { fontSize: 28, lineHeight: 1.5, fontWeight: 500 },
        mobile: { fontSize: 21, lineHeight: 1.5, fontWeight: 500 },
      },
    }),
    author(name, role, avatar, 'center'),
  ]
  return named(
    'Depoimentos',
    section(
      {
        ...band(kit, kit.id === 'saas'),
        anchor: 'depoimentos',
        contentAlign: 'center',
      },
      [
        kit.id === 'saas'
          ? card(kit, content, {
              maxWidth: { value: 880, unit: 'px' },
              gap: 28,
              alignItems: 'center',
            })
          : box(
              {
                maxWidth: { value: 880, unit: 'px' },
                gap: 28,
                alignItems: 'center',
              },
              content,
            ),
      ],
    ),
  )
}

// ─── pricing ──────────────────────────────────────────────────────────────

const PLANS = [
  [
    'Essencial',
    'R$ 49',
    'Para quem está começando.',
    ['1 usuário', 'Site com até 5 páginas', 'Suporte por e-mail'],
  ],
  [
    'Profissional',
    'R$ 129',
    'Para equipes em crescimento.',
    [
      '5 usuários',
      'Páginas ilimitadas',
      'Formulários no CRM',
      'Suporte prioritário',
    ],
  ],
  [
    'Empresa',
    'R$ 299',
    'Para operações maiores.',
    [
      'Usuários ilimitados',
      'Domínio próprio',
      'Gerente de conta',
      'SLA de atendimento',
    ],
  ],
] as const

export function pricingSection(kit: SiteKit): NodeSpec {
  return named(
    'Planos e preços',
    section(
      {
        ...band(kit, kit.id !== 'saas'),
        anchor: 'planos',
        contentAlign: centered(kit),
      },
      [
        head(
          kit,
          'Planos',
          'Escolha o plano ideal para o seu momento',
          'Sem fidelidade. Mude de plano quando quiser.',
        ),
        grid(
          3,
          PLANS.map(([name, price, note, features], index) => {
            const featured = index === 1
            return card(
              kit,
              [
                heading('h3', name, {
                  preset: 'h5',
                  color: featured ? 'token:inverse' : undefined,
                }),
                box({ direction: 'row', alignItems: 'baseline', gap: 6 }, [
                  text(`<p><strong>${price}</strong></p>`, {
                    preset: 'lead',
                    typography: { fontSize: 44, lineHeight: 1.1 },
                    color: featured ? 'token:inverse' : 'token:text',
                  }),
                  text('/mês', {
                    preset: 'small',
                    color: featured ? 'token:inverse' : 'token:muted',
                  }),
                ]),
                text(note, {
                  color: featured ? 'token:inverse' : 'token:muted',
                }),
                divider({
                  color: featured ? '#ffffff40' : 'token:border',
                  margin: spacing(8, 0),
                }),
                list([...features], {
                  markerColor: featured ? 'token:inverse' : 'token:primary',
                  color: featured ? 'token:inverse' : undefined,
                }),
                button('Assinar agora', anchor('contato'), {
                  variant: featured ? 'secondary' : 'outline',
                  align: 'stretch',
                  margin: spacing(16, 0),
                }),
              ],
              featured
                ? {
                    background: {
                      kind: 'color',
                      color: kit.id === 'b2b' ? 'token:dark' : 'token:primary',
                    },
                    textColor: 'token:inverse',
                    shadow: kit.card.shadow,
                    border: undefined,
                  }
                : {},
            )
          }),
          { alignItems: 'stretch' },
          1,
        ),
      ],
    ),
  )
}

// ─── faq ──────────────────────────────────────────────────────────────────

const QUESTIONS = [
  [
    'Quanto tempo leva um projeto?',
    'Projetos simples ficam prontos em duas semanas; os maiores seguem o cronograma combinado no plano.',
  ],
  [
    'Posso cancelar quando quiser?',
    'Sim. Não há fidelidade: você cancela pelo painel e não paga mais nada no mês seguinte.',
  ],
  [
    'Vocês atendem empresas de todo o Brasil?',
    'Sim, trabalhamos de forma remota com reuniões por vídeo e um canal direto no WhatsApp.',
  ],
  [
    'Como funciona o suporte?',
    'Você fala com pessoas de verdade por e-mail e chat, em horário comercial, com resposta no mesmo dia.',
  ],
]

export function faqSection(kit: SiteKit): NodeSpec {
  const items = QUESTIONS.map(([question, answer]) => {
    const content = [
      heading('h3', question, { preset: 'h5' }),
      text(answer, { color: 'token:muted' }),
    ]
    return kit.id === 'saas'
      ? card(kit, content, {
          gap: 10,
          padding: { base: spacing(28, 32), mobile: spacing(24, 20) },
        })
      : box({ gap: 10 }, content)
  })
  return named(
    'Perguntas frequentes',
    section({ ...band(kit, kit.id === 'saas'), contentAlign: centered(kit) }, [
      head(kit, 'Dúvidas', 'Perguntas frequentes'),
      kit.id === 'b2b'
        ? box(
            { gap: 32, maxWidth: { value: 860, unit: 'px' } },
            items.flatMap((item, index) =>
              index === 0 ? [item] : [divider({ margin: spacing(0) }), item],
            ),
          )
        : grid(
            2,
            items,
            {
              gap: { base: 32, mobile: 24 },
              maxWidth: { value: 1040, unit: 'px' },
            },
            1,
          ),
    ]),
  )
}

// ─── newsletter ───────────────────────────────────────────────────────────

const NEWSLETTER_FORM = {
  submitLabel: 'Quero receber',
  successMessage: 'Pronto! Você vai receber nossas novidades por e-mail.',
}

export function newsletterSection(kit: SiteKit): NodeSpec {
  const title = 'Receba novidades e conteúdos exclusivos'
  const intro =
    'Uma vez por mês, direto no seu e-mail. Sem spam — cancele quando quiser.'
  if (kit.id === 'b2b') {
    return named(
      'Newsletter',
      section(
        {
          background: kit.dark,
          textColor: 'token:inverse',
          padding: BAND_PADDING,
          anchor: 'contato',
        },
        [
          grid(
            2,
            [
              box({ gap: 16 }, [
                heading('h2', title, { preset: 'h3' }),
                text(intro),
              ]),
              form({ ...NEWSLETTER_FORM, buttonVariant: 'secondary' }),
            ],
            { alignItems: 'center' },
            1,
          ),
        ],
      ),
    )
  }
  const inner = [
    heading('h2', title, { preset: 'h3', align: 'center' }),
    text(intro, {
      align: 'center',
      color: kit.id === 'saas' ? '#ffffffcc' : 'token:muted',
    }),
    form({
      ...NEWSLETTER_FORM,
      buttonVariant: kit.id === 'saas' ? 'secondary' : 'primary',
    }),
  ]
  return named(
    'Newsletter',
    section(
      {
        background: kit.id === 'saas' ? kit.hero : kit.band,
        textColor: kit.id === 'saas' ? 'token:inverse' : undefined,
        padding: BAND_PADDING,
        contentAlign: 'center',
        anchor: 'contato',
      },
      [
        kit.id === 'agency'
          ? card(kit, inner, { maxWidth: { value: 640, unit: 'px' }, gap: 20 })
          : box({ maxWidth: { value: 640, unit: 'px' }, gap: 20 }, inner),
      ],
    ),
  )
}

// ─── footer ───────────────────────────────────────────────────────────────

const FOOTER_LINKS: Array<[string, string[]]> = [
  ['Empresa', ['Sobre nós', 'Carreiras', 'Imprensa']],
  ['Serviços', ['Design', 'Desenvolvimento', 'Conteúdo']],
  ['Ajuda', ['Central de ajuda', 'Privacidade', 'Termos de uso']],
]

export function footerSection(kit: SiteKit): NodeSpec {
  const inverse = kit.id !== 'agency'
  const muted = inverse ? '#ffffffb3' : 'token:muted'
  return named(
    'Rodapé',
    section(
      {
        tag: 'footer',
        background: inverse ? kit.dark : kit.band,
        textColor: inverse ? 'token:inverse' : undefined,
        padding: { base: spacing(80, 24), mobile: spacing(56, 20) },
        gap: 48,
      },
      [
        box(
          {
            layout: 'grid',
            columnsTemplate: {
              base: '2fr 1fr 1fr 1fr',
              tablet: '1fr 1fr 1fr',
              mobile: '1fr',
            },
            gap: { base: 48, mobile: 32 },
          },
          [
            box({ gap: 16 }, [
              logo(inverse),
              text(
                'Estratégia, design e tecnologia para empresas que querem crescer.',
                { color: muted, maxWidth: { value: 320, unit: 'px' } },
              ),
              social(['instagram', 'linkedin', 'youtube', 'whatsapp'], {
                color: inverse ? 'token:inverse' : 'token:text',
                background: inverse ? '#ffffff1a' : 'token:background',
                size: 40,
              }),
            ]),
            ...FOOTER_LINKS.map(([title, links]) =>
              box({ gap: 12 }, [
                heading('h2', title, { preset: 'h6' }),
                menu({
                  source: 'custom',
                  orientation: 'vertical',
                  justify: 'start',
                  gap: 4,
                  preset: 'small',
                  collapse: 'never',
                  label: title,
                  color: muted,
                  hoverColor: inverse ? 'token:inverse' : 'token:primary',
                  items: links.map((label) => ({ label, link: url('#') })),
                }),
              ]),
            ),
          ],
        ),
        divider({
          color: inverse ? '#ffffff26' : 'token:border',
          margin: spacing(0),
        }),
        text(`© ${BRAND}. Todos os direitos reservados.`, {
          preset: 'small',
          color: muted,
        }),
      ],
    ),
  )
}

export const SECTION_BUILDERS: Record<
  SiteSectionType,
  (kit: SiteKit) => NodeSpec
> = {
  header: headerSection,
  hero: heroSection,
  logos: logosSection,
  services: servicesSection,
  features: featuresSection,
  about: aboutSection,
  facts: factsSection,
  steps: stepsSection,
  works: worksSection,
  products: productsSection,
  testimonial: testimonialSection,
  pricing: pricingSection,
  faq: faqSection,
  newsletter: newsletterSection,
  footer: footerSection,
}
