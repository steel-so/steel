import z from 'zod'

/**
 * Vocabulário compartilhado de tipos de seção entre os 10 templates fixos.
 * Cada template habilita um subconjunto (definido no catálogo estático em
 * `src/lib/landing-page-templates/`), na ordem que o usuário escolher — uma
 * página pode repetir o mesmo tipo mais de uma vez (ex.: dois blocos de
 * Testimonial), então não há unicidade por tipo aqui.
 */
export const CrmLandingPageSectionTypeEnum = z.enum([
  'HEADER',
  'HERO',
  'SERVICES',
  'FACTS',
  'ABOUT',
  'TESTIMONIAL',
  'FEATURES',
  'WORKS',
  'FOOTER',
  'PRICING',
  'FAQ',
  'STEPS',
  'NEWSLETTER',
  'LOGOS',
  'PRODUCTS',
])

export type CrmLandingPageSectionType = z.infer<
  typeof CrmLandingPageSectionTypeEnum
>

/**
 * Free-form overrides every section accepts: copy and link targets that the
 * pixel-perfect templates render beyond the typed fields (badges, secondary
 * CTAs, "see more" links, decorative captions). Keyed by a stable slot name
 * chosen by the section component (`textOf`/`hrefOf` in
 * `app/_components/crm/landing-page/sections/overrides.ts`); an absent key
 * falls back to the template's default copy, so existing pages render the
 * same until edited.
 */
const OverrideKeySchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]{1,80}$/, 'Chave inválida')

const SectionOverridesShape = {
  texts: z
    .record(OverrideKeySchema, z.string().trim().max(2000))
    .refine((value) => Object.keys(value).length <= 120, {
      message: 'Textos demais na seção',
    })
    .optional(),
  hrefs: z
    .record(OverrideKeySchema, z.string().trim().max(500))
    .refine((value) => Object.keys(value).length <= 60, {
      message: 'Links demais na seção',
    })
    .optional(),
}

const LinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  href: z.string().trim().min(1).max(500),
})

// Um dropdown decorativo (ex.: "Selecionar local" de um formulário de busca
// que não tem backend real) cujas opções o editor pode customizar — usado só
// pelos poucos templates cujo Figma tem esse tipo de campo.
const DropdownFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  options: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
})

const HeaderContentSchema = z.object({
  type: z.literal('HEADER'),
  ...SectionOverridesShape,
  logoText: z.string().trim().min(1, 'Texto do logo é obrigatório').max(60),
  navLinks: z.array(LinkSchema).max(8).default([]),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaHref: z.string().trim().max(500).optional(),
})

const HeroContentSchema = z.object({
  type: z.literal('HERO'),
  ...SectionOverridesShape,
  eyebrow: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaHref: z.string().trim().max(500).optional(),
  imageUrl: z.string().trim().min(1).optional(),
  // Vídeo de fundo/preview autoplay opcional — quando definido, os templates
  // com um bloco de vídeo no Figma trocam a imagem estática pelo `<video>`
  // real (mudo, loop, sem controles). `imageUrl` continua servindo de poster.
  videoUrl: z.string().trim().min(1).optional(),
  // Nav embutida no próprio Hero — só usada por templates cujo frame do
  // Figma não tem uma seção HEADER separada (ex. Coworking). Optional puro
  // (sem `.default`) de propósito: ao contrário de `imageUrls`/`linkGroups`
  // em outros schemas, isso é usado por 1-2 templates só — exigir que todo
  // template preenchesse um array vazio seria ruído. Componentes leem com
  // `content.navLinks ?? []`.
  navLinks: z.array(LinkSchema).max(8).optional(),
  dropdowns: z.array(DropdownFieldSchema).max(4).optional(),
})

const ServiceItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  // Opcional — templates cujo grid de serviços/categorias tem uma imagem por
  // card (ex. categorias de e-commerce, salas de coworking) usam este campo;
  // os que não têm (Agency) simplesmente não o definem.
  imageUrl: z.string().trim().min(1).optional(),
})

const ServicesContentSchema = z.object({
  type: z.literal('SERVICES'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  items: z.array(ServiceItemSchema).max(12).default([]),
  // Ver comentário equivalente em HeroContentSchema — cobre o bloco de vídeo
  // decorativo que alguns templates (ex. B2B) colam depois da grade.
  videoUrl: z.string().trim().min(1).optional(),
})

const FactItemSchema = z.object({
  value: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
})

const FactsContentSchema = z.object({
  type: z.literal('FACTS'),
  ...SectionOverridesShape,
  items: z.array(FactItemSchema).max(8).default([]),
})

const AboutContentSchema = z.object({
  type: z.literal('ABOUT'),
  ...SectionOverridesShape,
  eyebrow: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  description: z.string().trim().max(4_000).default(''),
  imageUrl: z.string().trim().min(1).optional(),
  // Colagem de fotos adicionais (0-2), pra templates cujo layout tem mais de
  // uma imagem — `imageUrl` continua sendo a foto principal.
  imageUrls: z.array(z.string().trim().min(1)).max(2).optional().default([]),
  // Ver comentário em HeroContentSchema.dropdowns — optional puro de
  // propósito, só usado pelo bloco "CTA Form" do Consultation.
  dropdowns: z.array(DropdownFieldSchema).max(4).optional(),
})

const TestimonialContentSchema = z.object({
  type: z.literal('TESTIMONIAL'),
  ...SectionOverridesShape,
  quote: z.string().trim().min(1, 'Depoimento é obrigatório').max(1_000),
  authorName: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  authorRole: z.string().trim().max(160).optional(),
  avatarUrl: z.string().trim().min(1).optional(),
  // 'default' = avatar ao lado do texto, sobre o fundo da página.
  // 'spotlight' = bloco full-bleed com cor de destaque, conteúdo centralizado
  // — cobre o padrão de "seção de depoimento em destaque" usado por vários
  // templates (ex. o segundo bloco de Testimonial do Agency).
  style: z.enum(['default', 'spotlight']).optional().default('default'),
})

const FeatureItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  // "<hugeicon-name>:<hex-color>" — mesmo formato composto usado pelo
  // seletor de ícone de projeto (ver ProjectEmoji). Opcional: sem valor, o
  // componente do template cai no ícone fixo que já cicla por índice hoje.
  icon: z.string().trim().min(1).max(80).optional(),
})

const FeaturesContentSchema = z.object({
  type: z.literal('FEATURES'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  items: z.array(FeatureItemSchema).max(12).default([]),
  // Faixa de CTA opcional embaixo da grade de itens (título + texto próprios,
  // além do botão) — padrão usado por vários templates pra fechar a seção
  // com uma chamada pra ação.
  ctaTitle: z.string().trim().max(200).optional(),
  ctaDescription: z.string().trim().max(400).optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaHref: z.string().trim().max(500).optional(),
})

const WorkItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  category: z.string().trim().max(120).default(''),
  imageUrl: z.string().trim().min(1).optional(),
})

const WorksContentSchema = z.object({
  type: z.literal('WORKS'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  items: z.array(WorkItemSchema).max(12).default([]),
})

const FooterLinkGroupSchema = z.object({
  title: z.string().trim().min(1).max(60),
  links: z.array(LinkSchema).max(8).default([]),
})

const SocialLinkSchema = z.object({
  // String livre (não enum) pra não travar em templates futuros com outras
  // redes — o componente casa por nome conhecido e cai num ícone genérico
  // de link pro resto.
  platform: z.string().trim().min(1).max(40),
  href: z.string().trim().min(1).max(500),
})

const FooterContentSchema = z.object({
  type: z.literal('FOOTER'),
  ...SectionOverridesShape,
  logoText: z.string().trim().max(60).optional(),
  text: z.string().trim().max(300).optional(),
  linkGroups: z.array(FooterLinkGroupSchema).max(6).optional().default([]),
  socialLinks: z.array(SocialLinkSchema).max(8).optional().default([]),
  // Mesma faixa de CTA opcional que Features usa antes da grade de links.
  ctaTitle: z.string().trim().max(200).optional(),
  ctaDescription: z.string().trim().max(400).optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaHref: z.string().trim().max(500).optional(),
})

const PricingPlanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // String (não number) — mantém formatação livre: "$19", "Grátis", "Sob consulta".
  price: z.string().trim().min(1).max(40),
  period: z.string().trim().max(40).optional(),
  features: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaHref: z.string().trim().max(500).optional(),
  highlighted: z.boolean().optional().default(false),
  // Par opcional pro toggle mensal/anual — só definidos pelos templates cujo
  // Figma realmente mostra o toggle (hoje, Web Application). Sem eles, a
  // seção renderiza só `price`/`period`, sem toggle, como antes.
  yearlyPrice: z.string().trim().max(40).optional(),
  yearlyPeriod: z.string().trim().max(40).optional(),
})

const PricingContentSchema = z.object({
  type: z.literal('PRICING'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  plans: z.array(PricingPlanSchema).max(6).default([]),
})

const FaqItemSchema = z.object({
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().max(1_000).default(''),
})

const FaqContentSchema = z.object({
  type: z.literal('FAQ'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  items: z.array(FaqItemSchema).max(20).default([]),
})

const StepItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).default(''),
})

const StepsContentSchema = z.object({
  type: z.literal('STEPS'),
  ...SectionOverridesShape,
  eyebrow: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  imageUrl: z.string().trim().min(1).optional(),
  // Ver comentário em HeroContentSchema.videoUrl.
  videoUrl: z.string().trim().min(1).optional(),
  items: z.array(StepItemSchema).max(8).default([]),
})

const NewsletterContentSchema = z.object({
  type: z.literal('NEWSLETTER'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  description: z.string().trim().max(400).optional(),
  placeholder: z.string().trim().max(80).optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  // Quando definido, a seção embute o formulário real do workspace (id de um
  // CrmForm) em vez do input/botão decorativos — submissão de verdade via o
  // fluxo público já existente (`/api/crm/forms/[publicToken]/submit`).
  formId: z.string().trim().min(1).optional(),
})

const LogoItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  imageUrl: z.string().trim().min(1).optional(),
})

const LogosContentSchema = z.object({
  type: z.literal('LOGOS'),
  ...SectionOverridesShape,
  title: z.string().trim().max(200).optional(),
  logos: z.array(LogoItemSchema).max(12).default([]),
})

const ProductItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  price: z.string().trim().min(1).max(40),
  originalPrice: z.string().trim().max(40).optional(),
  rating: z.number().min(0).max(5).optional(),
  imageUrl: z.string().trim().min(1).optional(),
})

const ProductsContentSchema = z.object({
  type: z.literal('PRODUCTS'),
  ...SectionOverridesShape,
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subtitle: z.string().trim().max(400).optional(),
  items: z.array(ProductItemSchema).max(16).default([]),
})

export const CrmLandingPageSectionContentSchema = z.discriminatedUnion('type', [
  HeaderContentSchema,
  HeroContentSchema,
  ServicesContentSchema,
  FactsContentSchema,
  AboutContentSchema,
  TestimonialContentSchema,
  FeaturesContentSchema,
  WorksContentSchema,
  FooterContentSchema,
  PricingContentSchema,
  FaqContentSchema,
  StepsContentSchema,
  NewsletterContentSchema,
  LogosContentSchema,
  ProductsContentSchema,
])

export type CrmLandingPageSectionContent = z.infer<
  typeof CrmLandingPageSectionContentSchema
>

// Valida que `content.type` bate com `type` do envelope da seção — mesma
// checagem usada em CrmProposalSection (src/schemas/crm-proposal.schema.ts).
export const CrmLandingPageSectionInputSchema = z
  .object({
    type: CrmLandingPageSectionTypeEnum,
    order: z.number().int().nonnegative(),
    enabled: z.boolean().default(true),
    content: CrmLandingPageSectionContentSchema,
  })
  .refine((section) => section.content.type === section.type, {
    message: 'O conteúdo da seção não corresponde ao tipo declarado',
    path: ['content'],
  })

export type CrmLandingPageSectionInputDTO = z.infer<
  typeof CrmLandingPageSectionInputSchema
>
