import type { CanvasLink } from '@/src/lib/canvas/values'
import { spacing } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  button,
  form,
  grid,
  heading,
  icon,
  image,
  menu,
  type NodeSpec,
  named,
  overline,
  row,
  section,
  spec,
  text,
} from '@/src/lib/canvas-site/presets/builder'
import { ELEMENT_SECTION_BUILDERS } from '@/src/lib/canvas-site/presets/elements'
import type { SiteKit } from '@/src/lib/canvas-site/presets/kits'
import {
  band,
  card,
  centered,
  head,
  SECTION_BUILDERS,
} from '@/src/lib/canvas-site/presets/sections'
import type { SiteFormField } from '@/src/lib/canvas-site/schemas'
import { escapeHtml } from './slots'

/**
 * The sections the AI assembles pages from. Most are the catalog's ready
 * sections (any kit); the rest are built here because they carry real data
 * or site-wide links: page opener, call to action, contact with the CRM
 * form, CRM products, testimonials, event countdown, header and footer.
 * Copy in these specs is a placeholder the model rewrites through slots;
 * data nodes are named (`Produto`, `Preço`…) so they are never rewritten.
 */

export const SITE_AI_SECTIONS = [
  'hero',
  'intro',
  'services',
  'features',
  'about',
  'steps',
  'faq',
  'pricing',
  'products',
  'testimonials',
  'countdown',
  'cta',
  'contact',
] as const
export type SiteAiSection = (typeof SITE_AI_SECTIONS)[number]

/** What each section is, for the model (pt-BR). */
export const SITE_AI_SECTION_HINTS: Record<SiteAiSection, string> = {
  hero: 'destaque principal: título forte, subtítulo, botões e foto (só no topo da página Início)',
  intro: 'abertura de página interna: sobretítulo, título h1 e um parágrafo',
  services: 'três serviços em cartões, cada um com ícone, título e texto',
  features: 'quatro diferenciais curtos com ícone',
  about: 'quem somos: foto, título, texto e lista de pontos fortes',
  steps: 'como funciona em três passos numerados',
  faq: 'perguntas frequentes em acordeão',
  pricing: 'três planos com preço, recursos e botão',
  products:
    'produtos reais do CRM em cartões (nome, descrição e preço vêm do CRM)',
  testimonials:
    'depoimentos reais de clientes (o texto vem dos dados do workspace)',
  countdown: 'contagem regressiva até a data do evento, com chamada',
  cta: 'faixa escura de chamada para ação com título, texto e botão',
  contact: 'contato: texto de convite e o formulário do CRM',
}

export interface SiteAiProductData {
  name: string
  description: string
  price: string
}

export interface SiteAiTestimonialData {
  quote: string
  name: string
  role: string
}

export interface SiteAiFormData {
  formToken: string
  formName: string
  fields: SiteFormField[]
}

/** Everything a section builder may need besides the kit. */
export interface SectionContext {
  kit: SiteKit
  companyName: string
  logoUrl: string | null
  ctaLabel: string
  /** Where calls to action point (the contact page, or the contact
   * section of the current page). */
  contactLink: CanvasLink
  products: SiteAiProductData[]
  testimonials: SiteAiTestimonialData[]
  form: SiteAiFormData | null
  eventDate: string | null
  /** Title of the page (intro section). */
  pageTitle: string
}

export const CONTACT_ANCHOR = 'contato'

function introSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  const align = kit.headAlign
  return named(
    'Abertura da página',
    section(
      {
        background: kit.id === 'saas' ? kit.hero : kit.band,
        textColor: kit.id === 'saas' ? kit.heroText : undefined,
        padding: {
          base: spacing(96, 24),
          tablet: spacing(80, 24),
          mobile: spacing(56, 20),
        },
        contentAlign: centered(kit),
      },
      [
        box(
          {
            maxWidth: { value: 760, unit: 'px' },
            alignItems: align === 'center' ? 'center' : 'start',
            textAlign: align,
            gap: 16,
          },
          [
            overline(ctx.pageTitle, {
              align,
              color: kit.id === 'saas' ? '#ffffffcc' : kit.overline,
            }),
            heading('h1', `${ctx.pageTitle} da ${ctx.companyName}`, { align }),
            text(
              'Um parágrafo curto que apresenta o assunto desta página e o que o visitante encontra nela.',
              {
                preset: 'lead',
                align,
                color: kit.id === 'saas' ? '#ffffffcc' : 'token:muted',
              },
            ),
          ],
        ),
      ],
    ),
  )
}

function ctaSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  return named(
    'Chamada para ação',
    section(
      {
        ...band(kit),
        background: kit.dark,
        textColor: 'token:inverse',
        contentAlign: 'center',
      },
      [
        box(
          {
            maxWidth: { value: 720, unit: 'px' },
            alignItems: 'center',
            textAlign: 'center',
            gap: 20,
          },
          [
            heading('h2', 'Vamos conversar sobre o seu projeto?', {
              align: 'center',
              color: 'token:inverse',
            }),
            text(
              'Conte o que você precisa e a nossa equipe responde em pouco tempo.',
              { align: 'center', color: '#ffffffcc' },
            ),
            button(ctx.ctaLabel, ctx.contactLink, {
              variant: kit.id === 'b2b' ? 'primary' : 'secondary',
              size: 'lg',
              align: 'center',
            }),
          ],
        ),
      ],
    ),
  )
}

function contactSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  return named(
    'Contato',
    section({ ...band(kit, true), anchor: CONTACT_ANCHOR }, [
      grid(
        2,
        [
          box({ gap: 16, alignItems: 'start' }, [
            overline('Contato', { color: kit.overline }),
            heading('h2', 'Fale com a gente'),
            text(
              'Preencha o formulário e retornamos o quanto antes com a melhor solução para você.',
              { preset: 'lead', color: 'token:muted' },
            ),
          ]),
          card(kit, [
            form({
              formToken: ctx.form?.formToken ?? '',
              formName: ctx.form?.formName ?? '',
              fields: ctx.form?.fields ?? [],
              submitLabel: 'Enviar mensagem',
              successMessage:
                'Recebemos seu contato! Em breve falamos com você.',
              buttonAlign: 'stretch',
            }),
          ]),
        ],
        { alignItems: 'start', gap: { base: 64, mobile: 32 } },
        1,
      ),
    ]),
  )
}

function productsSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  const columns = Math.min(3, Math.max(1, ctx.products.length))
  return named(
    'Produtos',
    section({ ...band(kit), anchor: 'produtos', contentAlign: centered(kit) }, [
      head(kit, 'Produtos', 'Conheça o que preparamos para você'),
      grid(
        columns,
        ctx.products.map((product) =>
          card(
            kit,
            [
              named(
                'Produto',
                heading('h3', product.name.slice(0, 140), { preset: 'h5' }),
              ),
              ...(product.description
                ? [
                    named(
                      'Descrição do produto',
                      text(escapeHtml(product.description.slice(0, 600)), {
                        color: 'token:muted',
                      }),
                    ),
                  ]
                : []),
              named(
                'Preço',
                text(escapeHtml(product.price), {
                  preset: 'lead',
                  color: 'token:primary',
                  typography: { fontWeight: 700 },
                }),
              ),
              button('Quero este', ctx.contactLink, {
                size: 'sm',
                align: 'stretch',
              }),
            ],
            { gap: 12, justify: 'between' },
          ),
        ),
        {},
        Math.min(columns, 2),
      ),
    ]),
  )
}

function testimonialsSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  const items = ctx.testimonials.slice(0, 3)
  return named(
    'Depoimentos',
    section(
      {
        ...band(kit, true),
        anchor: 'depoimentos',
        contentAlign: centered(kit),
      },
      [
        head(kit, 'Depoimentos', 'O que nossos clientes dizem'),
        grid(
          Math.max(1, items.length),
          items.map((item) =>
            card(
              kit,
              [
                icon('quote', {
                  size: 32,
                  shape: 'none',
                  color: 'token:primary',
                }),
                named(
                  'Depoimento',
                  text(`<p>“${escapeHtml(item.quote.slice(0, 900))}”</p>`),
                ),
                named(
                  'Autor do depoimento',
                  text(
                    `<p><strong>${escapeHtml(item.name.slice(0, 120))}</strong>${
                      item.role
                        ? ` — ${escapeHtml(item.role.slice(0, 160))}`
                        : ''
                    }</p>`,
                    { preset: 'small', color: 'token:muted' },
                  ),
                ),
              ],
              { gap: 20 },
            ),
          ),
          {},
          1,
        ),
      ],
    ),
  )
}

function countdownSection(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  return named(
    'Contagem regressiva',
    section(
      {
        ...band(kit),
        background: kit.dark,
        textColor: 'token:inverse',
        contentAlign: 'center',
        anchor: 'evento',
      },
      [
        overline('Falta pouco', {
          align: 'center',
          color: kit.id === 'agency' ? 'token:accent' : '#ffffffb3',
        }),
        heading('h2', 'Garanta sua vaga no evento', {
          align: 'center',
          color: 'token:inverse',
        }),
        spec(SITE_TYPES.countdown, {
          date: ctx.eventDate ?? '',
          time: '09:00',
          offset: '-03:00',
          expiredText: 'O evento já começou. Fale com a gente!',
          boxBackground: '#ffffff1a',
          numberColor: 'token:inverse',
          labelColor: '#ffffffb3',
        }),
        button(ctx.ctaLabel, ctx.contactLink, {
          variant: kit.id === 'b2b' ? 'primary' : 'secondary',
          size: 'lg',
          align: 'center',
        }),
      ],
    ),
  )
}

/** One body section of a page. */
export function buildSection(
  type: SiteAiSection,
  ctx: SectionContext,
): NodeSpec {
  switch (type) {
    case 'intro':
      return introSection(ctx)
    case 'cta':
      return ctaSection(ctx)
    case 'contact':
      return contactSection(ctx)
    case 'products':
      return productsSection(ctx)
    case 'testimonials':
      return testimonialsSection(ctx)
    case 'countdown':
      return countdownSection(ctx)
    case 'faq':
      return ELEMENT_SECTION_BUILDERS['faq-accordion'](ctx.kit)
    default:
      return SECTION_BUILDERS[type](ctx.kit)
  }
}

// ─── globals ──────────────────────────────────────────────────────────────

function logo(ctx: SectionContext, inverse: boolean): NodeSpec {
  if (ctx.logoUrl) {
    return named(
      'Logo',
      image(ctx.logoUrl, ctx.companyName.slice(0, 160), {
        maxWidth: { value: 160, unit: 'px' },
        width: { value: null, unit: 'auto' },
        fit: 'contain',
        link: { type: 'url', value: '/' },
      }),
    )
  }
  return named(
    'Logo',
    text(
      `<p><strong>${escapeHtml(ctx.companyName.slice(0, 80))}</strong></p>`,
      {
        preset: 'lead',
        color: inverse ? 'token:inverse' : 'token:text',
        typography: { fontSize: 24, fontWeight: 700, letterSpacing: -0.5 },
      },
    ),
  )
}

/** Site header: logo, the pages menu and the call to action. */
export function buildHeader(ctx: SectionContext): NodeSpec {
  const { kit } = ctx
  const inverse = kit.id === 'saas'
  return named(
    'Cabeçalho',
    section(
      {
        tag: 'header',
        background: inverse
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
            logo(ctx, inverse),
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
                  source: 'pages',
                  items: [],
                  justify: 'end',
                  label: 'Menu principal',
                  color: inverse ? 'token:inverse' : 'token:text',
                  hoverColor: inverse ? 'token:inverse' : 'token:primary',
                }),
                button(ctx.ctaLabel, ctx.contactLink, {
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

/** Site footer: logo, tagline, the pages menu and the copyright line. */
export function buildFooter(ctx: SectionContext, tagline: string): NodeSpec {
  const { kit } = ctx
  const inverse = kit.id !== 'agency'
  const muted = inverse ? '#ffffffb3' : 'token:muted'
  return named(
    'Rodapé',
    section(
      {
        tag: 'footer',
        background: inverse ? kit.dark : kit.band,
        textColor: inverse ? 'token:inverse' : undefined,
        padding: { base: spacing(72, 24), mobile: spacing(48, 20) },
        gap: 40,
      },
      [
        box(
          {
            layout: 'grid',
            columnsTemplate: { base: '2fr 1fr', mobile: '1fr' },
            gap: { base: 48, mobile: 32 },
          },
          [
            box({ gap: 16 }, [
              logo(ctx, inverse),
              text(escapeHtml(tagline), {
                color: muted,
                maxWidth: { value: 360, unit: 'px' },
              }),
            ]),
            box({ gap: 12 }, [
              heading('h2', 'Navegue', { preset: 'h6' }),
              menu({
                source: 'pages',
                items: [],
                orientation: 'vertical',
                justify: 'start',
                gap: 4,
                preset: 'small',
                collapse: 'never',
                label: 'Páginas do site',
                color: muted,
                hoverColor: inverse ? 'token:inverse' : 'token:primary',
              }),
            ]),
          ],
        ),
        named(
          'Direitos',
          text(
            `© ${escapeHtml(ctx.companyName.slice(0, 80))}. Todos os direitos reservados.`,
            { preset: 'small', color: muted },
          ),
        ),
      ],
    ),
  )
}
