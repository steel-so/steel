import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "09-Product" do kit Figma de referência (node 0:181,
 * arquivo "Brainwave.io - Landing Page UI Kit"). Página de produto único
 * (estilo AirPods) — ordem de seções segue o fluxo vertical real do frame:
 * Header → Hero (foto + "watch in action") → Content 01 (FEATURES: 2 itens
 * com ícone + foto) → Content 02 (TESTIMONIAL: depoimento + foto diagonal)
 * → Content 03 (ABOUT: texto + wave decorativa + 2 fotos do produto) →
 * Pricing (PRODUCTS: 3 variantes de cor do mesmo AirPods) → Footer
 * (minimalista, sem colunas).
 */
export const productTemplate: LandingPageTemplateDefinition = {
  key: 'product',
  name: 'Lançamento de produto',
  description: 'Modelo para lançamento de um único produto, estilo AirPods.',
  sections: [
    {
      type: 'HEADER',
      content: {
        type: 'HEADER',
        logoText: 'Sua Empresa',
        navLinks: [
          { label: 'Demonstrações', href: '#' },
          { label: 'Páginas', href: '#' },
          { label: 'Suporte', href: '#' },
          { label: 'Contato', href: '#footer' },
        ],
        ctaLabel: 'Compre agora - a partir de R$ 99',
        ctaHref: '#pricing',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        eyebrow: 'Música sem parar por muito tempo',
        title: 'Um som que soa melhor!',
        subtitle:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie seu próximo site em poucos minutos.',
        ctaLabel: 'Compre agora - a partir de R$ 99',
        ctaHref: '#pricing',
        imageUrl: '/landing-page-templates/product/hero-airpod.png',
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Ouça música a qualquer hora, em qualquer lugar.',
        subtitle:
          'Compartilhamos tendências e estratégias para você melhorar seus resultados.',
        items: [
          {
            title: 'Fones confortáveis',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código.',
          },
          {
            title: 'Graves potentes',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código.',
          },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Vocês deixaram tudo muito simples. Meu novo site é muito mais rápido e fácil de usar que o antigo.',
        authorName: 'Rhoda Brady',
        avatarUrl: '/landing-page-templates/product/testimonial-avatar.png',
        style: 'spotlight',
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Design moderno com mais qualidade de som.',
        description:
          'Compartilhamos tendências e estratégias para você melhorar seus resultados.',
        imageUrl: '/landing-page-templates/product/about-earbuds-left.png',
        imageUrls: ['/landing-page-templates/product/about-earbuds-right.png'],
      },
    },
    {
      type: 'PRODUCTS',
      content: {
        type: 'PRODUCTS',
        title: 'Garanta o seu agora.',
        subtitle:
          'Compartilhamos tendências e estratégias para você melhorar seus resultados.',
        items: [
          {
            title: 'AirPods — Verde-meia-noite',
            price: 'R$ 99',
            imageUrl:
              '/landing-page-templates/product/product-midnight-green.png',
          },
          {
            title: 'AirPods — Prata',
            price: 'R$ 99',
            imageUrl: '/landing-page-templates/product/product-silver.png',
          },
          {
            title: 'AirPods — Dourado',
            price: 'R$ 99',
            imageUrl: '/landing-page-templates/product/product-gold.png',
          },
        ],
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        logoText: 'Sua Empresa',
        linkGroups: [
          {
            title: 'Legal',
            links: [
              { label: 'Política de Privacidade', href: '#' },
              { label: 'Termos e Condições', href: '#' },
              { label: 'Suporte', href: '#' },
            ],
          },
        ],
        socialLinks: [],
      },
    },
  ],
}
