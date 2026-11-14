import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "10-B2B" do kit Figma de referência (node 0:2, mesmo kit
 * visual "Brainwave.io" do template Agency). Ordem de seções segue o fluxo
 * vertical real do frame: Header → Hero (Alert dobrado dentro do Hero, ver
 * `sections/b2b/hero.tsx`) → Content 01 (About) → Services (Video dobrado
 * no fim da seção, ver `sections/b2b/services.tsx`) → Content 02 (Features)
 * → Testimonial → Footer (CTA "Ready to get started?" dobrado no topo do
 * Footer).
 */
export const b2bTemplate: LandingPageTemplateDefinition = {
  key: 'b2b',
  name: 'B2B',
  description: 'Modelo para consultorias e empresas B2B.',
  sections: [
    {
      type: 'HEADER',
      content: {
        type: 'HEADER',
        logoText: 'Brainwave.io',
        navLinks: [
          { label: 'Demos', href: '#' },
          { label: 'Páginas', href: '#' },
          { label: 'Suporte', href: '#' },
          { label: 'Contato', href: '#footer' },
        ],
        ctaLabel: 'Solicitar orçamento grátis',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        eyebrow: 'Quer saber como o nosso software funciona para você?',
        title: 'Dê mais poder ao seu negócio com a Sua Empresa.',
        subtitle:
          'Com vários blocos exclusivos, você monta sua página sem escrever código. Crie o site da sua consultoria em poucos minutos.',
        ctaLabel: 'Solicitar orçamento grátis',
        ctaHref: '#footer',
        imageUrl: '/landing-page-templates/b2b/hero-portrait.png',
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Especialistas experientes prontos para orientar você.',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        imageUrl: '/landing-page-templates/b2b/content01-photo.png',
        imageUrls: [],
      },
    },
    {
      type: 'SERVICES',
      content: {
        type: 'SERVICES',
        title: 'Serviços que oferecemos para você',
        subtitle:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        items: [
          {
            title: 'Marketing Digital',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
            imageUrl:
              '/landing-page-templates/b2b/services-digital-marketing.png',
          },
          {
            title: 'Crescimento de Negócios',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
            imageUrl:
              '/landing-page-templates/b2b/services-business-growth.png',
          },
          {
            title: 'Marketing de Conteúdo',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
            imageUrl:
              '/landing-page-templates/b2b/services-content-marketing.png',
          },
        ],
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Motivos para nos escolher e crescer hoje mesmo.',
        subtitle:
          'Compartilhamos tendências e estratégias para aumentar a sua receita e manter a sua empresa sempre em alta demanda.',
        items: [
          { title: 'Totalmente Responsivo', description: '' },
          { title: 'Layouts Elegantes', description: '' },
          { title: 'Fácil de Editar', description: '' },
          { title: 'Fontes do Google Incluídas', description: '' },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Vocês deixaram tudo muito simples. Meu novo site é bem mais rápido e fácil de usar do que o antigo.',
        authorName: 'Isabella Chavez',
        authorRole: 'Designer Gráfica',
        avatarUrl: '/landing-page-templates/b2b/testimonial-avatar-1.png',
        style: 'default',
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        logoText: 'Brainwave.io',
        text: 'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        ctaTitle: 'Pronto para começar?',
        ctaLabel: 'Solicitar orçamento grátis',
        ctaHref: '#',
        linkGroups: [
          {
            title: 'Empresa',
            links: [
              { label: 'Sobre nós', href: '#' },
              { label: 'Fale conosco', href: '#' },
              { label: 'Carreiras', href: '#' },
              { label: 'Imprensa', href: '#' },
            ],
          },
          {
            title: 'Produto',
            links: [
              { label: 'Recursos', href: '#' },
              { label: 'Preços', href: '#' },
              { label: 'Novidades', href: '#' },
              { label: 'Central de ajuda', href: '#' },
              { label: 'Suporte', href: '#' },
            ],
          },
          {
            title: 'Serviços',
            links: [
              { label: 'Marketing Digital', href: '#' },
              { label: 'Produção de Conteúdo', href: '#' },
              { label: 'SEO para Empresas', href: '#' },
              { label: 'Design de Interface', href: '#' },
            ],
          },
          {
            title: 'Legal',
            links: [
              { label: 'Política de Privacidade', href: '#' },
              { label: 'Termos e Condições', href: '#' },
              { label: 'Política de Devolução', href: '#' },
            ],
          },
        ],
        socialLinks: [
          { platform: 'twitter', href: '#' },
          { platform: 'facebook', href: '#' },
          { platform: 'instagram', href: '#' },
          { platform: 'linkedin', href: '#' },
        ],
      },
    },
  ],
}
