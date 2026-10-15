import { spacing } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '../constants'
import {
  anchor,
  box,
  button,
  heading,
  image,
  type NodeSpec,
  named,
  overline,
  section,
  spec,
  text,
} from './builder'
import type { SiteKit } from './kits'
import { band, centered, head } from './sections'

/**
 * Ready-made sections built on the S2 elements (gallery, carousel, tabs,
 * accordion, countdown, statistics, testimonials slider, pricing table,
 * logo strip, map + WhatsApp, before/after) and the offer popup, one per
 * kit like the landing-page sections. Copy is pt-BR; images come from the
 * kits' public assets.
 */

export const SITE_ELEMENT_SECTION_TYPES = [
  'hero-slider',
  'gallery',
  'tabs',
  'faq-accordion',
  'stats',
  'countdown',
  'testimonials-slider',
  'pricing-table',
  'logo-strip',
  'contact-map',
  'before-after',
  'popup-offer',
] as const
export type SiteElementSectionType = (typeof SITE_ELEMENT_SECTION_TYPES)[number]

export const SITE_ELEMENT_SECTION_LABELS: Record<
  SiteElementSectionType,
  string
> = {
  'hero-slider': 'Destaque em carrossel',
  gallery: 'Galeria de fotos',
  tabs: 'Conteúdo em abas',
  'faq-accordion': 'Perguntas (acordeão)',
  stats: 'Números animados',
  countdown: 'Contagem regressiva',
  'testimonials-slider': 'Depoimentos em carrossel',
  'pricing-table': 'Tabela de preços',
  'logo-strip': 'Faixa de logos',
  'contact-map': 'Mapa e WhatsApp',
  'before-after': 'Antes e depois',
  'popup-offer': 'Popup de oferta',
}

const IMG = '/landing-page-templates'

function heroSlider(kit: SiteKit): NodeSpec {
  const slides: Array<[string, string, string]> = [
    [
      'Sites que vendem enquanto você dorme',
      'Monte páginas rápidas, bonitas e ligadas ao seu CRM em poucos minutos.',
      `${IMG}/saas-subscription/hero-mockup.png`,
    ],
    [
      'Atendimento no WhatsApp, direto do site',
      'Cada contato vira lead e cai na fila certa da sua equipe.',
      `${IMG}/agency/hero-portrait.png`,
    ],
    [
      'Resultados que você acompanha',
      'Visitas, formulários e conversões no mesmo painel.',
      `${IMG}/b2b/content01-photo.png`,
    ],
  ]
  return named(
    'Destaque em carrossel',
    section({ ...band(kit, true), padding: spacing(48, 24) }, [
      spec(
        SITE_TYPES.carousel,
        { label: 'Destaques', autoplay: true, interval: 7 },
        slides.map(([title, copy, src], index) =>
          spec(
            SITE_TYPES.slide,
            {
              background: kit.hero,
              padding: { base: spacing(56, 56), mobile: spacing(32, 20) },
              radius: kit.card.radius,
              gap: 32,
              minHeight: { value: 420, unit: 'px' },
            },
            [
              box(
                {
                  layout: 'grid',
                  columns: { base: 2, mobile: 1 },
                  gap: { base: 48, mobile: 24 },
                  alignItems: 'center',
                },
                [
                  box({ gap: 20 }, [
                    heading(index === 0 ? 'h2' : 'h3', title, {
                      preset: 'h2',
                      color: kit.heroText,
                    }),
                    text(copy, {
                      preset: 'lead',
                      // Readable on the kit's hero band (dark in SaaS).
                      color: kit.heroText ? '#ffffffcc' : 'token:muted',
                    }),
                    button('Comece agora', anchor('contato'), {
                      size: 'lg',
                    }),
                  ]),
                  image(src, '', {
                    aspectRatio: '4/3',
                    radius: kit.photo,
                    visibility: { base: true, tablet: true, mobile: false },
                  }),
                ],
              ),
            ],
          ),
        ),
      ),
    ]),
  )
}

function gallery(kit: SiteKit): NodeSpec {
  return named(
    'Galeria',
    section({ ...band(kit), anchor: 'galeria', contentAlign: centered(kit) }, [
      head(kit, 'Portfólio', 'Trabalhos recentes'),
      spec(SITE_TYPES.gallery, {
        layout: kit.id === 'agency' ? 'masonry' : 'grid',
        radius: kit.photo,
      }),
    ]),
  )
}

function tabs(kit: SiteKit): NodeSpec {
  const panels: Array<[string, string, string[]]> = [
    [
      'Para vendas',
      'Funil, propostas e metas no mesmo lugar.',
      [
        'Pipeline por etapas',
        'Propostas com assinatura',
        'Previsão de receita',
      ],
    ],
    [
      'Para marketing',
      'Campanhas, formulários e páginas que geram leads.',
      ['Sites e landing pages', 'E-mail e WhatsApp', 'Relatórios de origem'],
    ],
    [
      'Para atendimento',
      'Chamados, SLA e base de conhecimento.',
      ['Fila por prioridade', 'SLA por contrato', 'Portal do cliente'],
    ],
  ]
  return named(
    'Abas',
    section({ ...band(kit, true), contentAlign: centered(kit) }, [
      head(kit, 'Soluções', 'Uma plataforma para cada equipe'),
      spec(
        SITE_TYPES.tabs,
        {
          variant:
            kit.id === 'saas'
              ? 'pills'
              : kit.id === 'b2b'
                ? 'underline'
                : 'boxed',
          align: kit.headAlign === 'center' ? 'center' : 'start',
          gap: 24,
        },
        panels.map(([label, copy, items]) =>
          spec(SITE_TYPES.tab, { label, padding: spacing(24, 0), gap: 16 }, [
            text(copy, { preset: 'lead', align: kit.headAlign }),
            spec(SITE_TYPES.list, {
              items: items.map((value) => ({ text: value })),
              columns: { base: 3, mobile: 1 },
            }),
          ]),
        ),
      ),
    ]),
  )
}

const QUESTIONS: Array<[string, string]> = [
  [
    'Quanto tempo leva para colocar no ar?',
    'Com um modelo pronto, o site fica no ar no mesmo dia. Projetos sob medida seguem o cronograma combinado.',
  ],
  [
    'Posso usar meu próprio domínio?',
    'Sim. Aponte o seu domínio e nós cuidamos do certificado de segurança.',
  ],
  [
    'Os contatos do site vão para o CRM?',
    'Todos: formulários, cliques no WhatsApp e popups viram leads com a origem da visita.',
  ],
  [
    'Existe fidelidade?',
    'Não. Você cancela quando quiser, direto pelo painel.',
  ],
]

function faqAccordion(kit: SiteKit): NodeSpec {
  return named(
    'Perguntas frequentes',
    section({ ...band(kit), anchor: 'perguntas', contentAlign: 'center' }, [
      head(kit, 'Dúvidas', 'Perguntas frequentes'),
      box(
        {
          maxWidth: { value: 820, unit: 'px' },
          width: { value: 100, unit: '%' },
        },
        [
          spec(
            SITE_TYPES.accordion,
            {
              variant: kit.id === 'b2b' ? 'minimal' : 'separated',
              icon: kit.id === 'saas' ? 'plus' : 'chevron',
              radius: kit.card.radius,
            },
            QUESTIONS.map(([title, answer], index) =>
              spec(SITE_TYPES.accordionItem, { title, open: index === 0 }, [
                text(answer, { color: 'token:muted' }),
              ]),
            ),
          ),
        ],
      ),
    ]),
  )
}

function stats(kit: SiteKit): NodeSpec {
  const inverse = kit.id === 'b2b'
  return named(
    'Números',
    section(
      {
        ...band(kit),
        background: inverse ? kit.dark : kit.band,
        textColor: inverse ? 'token:inverse' : undefined,
        padding: { base: spacing(72, 24), mobile: spacing(56, 20) },
      },
      [
        spec(SITE_TYPES.stats, {
          numberColor: inverse ? 'token:inverse' : 'token:primary',
          labelColor: inverse ? '#ffffffb3' : undefined,
          dividers: kit.id === 'b2b',
          animation: { effect: 'fade-up' },
        }),
      ],
    ),
  )
}

function countdown(kit: SiteKit): NodeSpec {
  return named(
    'Contagem regressiva',
    section(
      {
        ...band(kit),
        background: kit.dark,
        textColor: 'token:inverse',
        contentAlign: 'center',
        anchor: 'oferta',
      },
      [
        overline('Oferta de lançamento', {
          align: 'center',
          color: kit.id === 'agency' ? 'token:accent' : '#ffffffb3',
        }),
        heading('h2', '30% de desconto até o fim da semana', {
          align: 'center',
          color: 'token:inverse',
        }),
        spec(SITE_TYPES.countdown, {
          boxBackground: '#ffffff1a',
          numberColor: 'token:inverse',
          labelColor: '#ffffffb3',
        }),
        button('Garantir meu desconto', anchor('planos'), {
          variant: kit.id === 'b2b' ? 'primary' : 'secondary',
          size: 'lg',
          align: 'center',
        }),
      ],
    ),
  )
}

function testimonialsSlider(kit: SiteKit): NodeSpec {
  return named(
    'Depoimentos',
    section(
      {
        ...band(kit, kit.id !== 'b2b'),
        anchor: 'depoimentos',
        contentAlign: centered(kit),
      },
      [
        head(kit, 'Depoimentos', 'Quem usa recomenda'),
        spec(SITE_TYPES.testimonials, {
          layout: 'slider',
          columns: { base: 2, mobile: 1 },
          align: kit.headAlign === 'center' ? 'center' : 'left',
          cardBackground:
            kit.id === 'b2b' ? 'token:surface' : 'token:background',
          radius: kit.card.radius,
          shadow: kit.card.shadow,
          border: kit.card.border,
        }),
      ],
    ),
  )
}

function pricingTable(kit: SiteKit): NodeSpec {
  return named(
    'Planos',
    section(
      {
        ...band(kit, kit.id !== 'saas'),
        anchor: 'planos',
        contentAlign: centered(kit),
      },
      [
        head(kit, 'Planos', 'Preços simples, sem surpresas'),
        spec(SITE_TYPES.pricing, {
          align: kit.headAlign === 'center' ? 'center' : 'left',
          radius: kit.card.radius,
          highlightBackground:
            kit.id === 'b2b' ? 'token:dark' : 'token:primary',
        }),
      ],
    ),
  )
}

function logoStrip(kit: SiteKit): NodeSpec {
  return named(
    'Logos',
    section(
      {
        ...band(kit),
        padding: { base: spacing(56, 24), mobile: spacing(40, 20) },
        gap: 24,
      },
      [
        text('Empresas que confiam no nosso trabalho', {
          preset: 'small',
          align: 'center',
          color: 'token:muted',
        }),
        spec(SITE_TYPES.logos, {}),
      ],
    ),
  )
}

function contactMap(kit: SiteKit): NodeSpec {
  return named(
    'Mapa e contato',
    section({ ...band(kit, true), anchor: 'contato' }, [
      box(
        {
          layout: 'grid',
          columnsTemplate: { base: '2fr 3fr', mobile: '1fr' },
          gap: { base: 48, mobile: 32 },
          alignItems: 'center',
        },
        [
          box({ gap: 16 }, [
            overline('Contato', { color: kit.overline }),
            heading('h2', 'Venha tomar um café com a gente'),
            text(
              'Avenida Paulista, 1000 · São Paulo, SP<br>Segunda a sexta, das 9h às 18h.',
              { color: 'token:muted' },
            ),
            spec(SITE_TYPES.whatsapp, {
              mode: 'inline',
              phone: '+55 11 91234-5678',
              label: 'Chamar no WhatsApp',
            }),
          ]),
          spec(SITE_TYPES.map, { radius: kit.photo }),
        ],
      ),
      spec(SITE_TYPES.whatsapp, { phone: '+55 11 91234-5678' }),
    ]),
  )
}

function beforeAfter(kit: SiteKit): NodeSpec {
  return named(
    'Antes e depois',
    section({ ...band(kit), contentAlign: 'center' }, [
      head(
        kit,
        'Resultados',
        'Veja a diferença',
        'Arraste a divisória para comparar.',
      ),
      box(
        {
          maxWidth: { value: 960, unit: 'px' },
          width: { value: 100, unit: '%' },
        },
        [spec(SITE_TYPES.beforeAfter, { radius: kit.photo })],
      ),
    ]),
  )
}

function popupOffer(kit: SiteKit): NodeSpec {
  return named(
    'Popup de oferta',
    spec(
      SITE_TYPES.popup,
      {
        name: 'Oferta de boas-vindas',
        anchor: 'boas-vindas',
        trigger: 'delay',
        delay: 8,
        radius: kit.card.radius,
      },
      [
        overline('Só hoje', { align: 'center', color: kit.overline }),
        heading('h2', 'Ganhe 10% na primeira compra', {
          preset: 'h3',
          align: 'center',
        }),
        text('Fale com a nossa equipe e garanta o cupom de boas-vindas.', {
          align: 'center',
          color: 'token:muted',
        }),
        button('Quero o cupom', anchor('contato'), {
          align: 'stretch',
          interaction: { action: 'close' },
        }),
      ],
    ),
  )
}

export const ELEMENT_SECTION_BUILDERS: Record<
  SiteElementSectionType,
  (kit: SiteKit) => NodeSpec
> = {
  'hero-slider': heroSlider,
  gallery,
  tabs,
  'faq-accordion': faqAccordion,
  stats,
  countdown,
  'testimonials-slider': testimonialsSlider,
  'pricing-table': pricingTable,
  'logo-strip': logoStrip,
  'contact-map': contactMap,
  'before-after': beforeAfter,
  'popup-offer': popupOffer,
}
