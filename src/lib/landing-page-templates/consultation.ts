import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "08-Consultation" do kit Figma de referência (node 0:290).
 * Ordem de seções segue o fluxo vertical real do frame: Header → Hero →
 * Facts → Services → Content (STEPS: vídeo + 3 passos) → Testimonial (3
 * cards, cada um sua própria seção) → CTA Form (formulário de contato) →
 * CTA (NEWSLETTER) → Footer.
 *
 * "Alert" (tarja "novidade v3.0") não tem tipo próprio no vocabulário
 * compartilhado — dobrado dentro do componente HERO, decorativo. "CTA Form"
 * (painel escuro + formulário) usa ABOUT (título+descrição) com o card de
 * formulário decorativo/fixo no componente, sem submissão real.
 */
export const consultationTemplate: LandingPageTemplateDefinition = {
  key: 'consultation',
  name: 'Consultoria',
  description: 'Modelo para consultorias e escritórios de assessoria.',
  sections: [
    {
      type: 'HEADER',
      content: {
        type: 'HEADER',
        logoText: 'Sua Empresa',
        navLinks: [
          { label: 'Demos', href: '#' },
          { label: 'Páginas', href: '#' },
          { label: 'Suporte', href: '#' },
          { label: 'Contato', href: '#footer' },
        ],
        ctaLabel: 'Comece agora',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        title: 'Conte com a ajuda de consultores especialistas.',
        subtitle:
          'Com vários blocos exclusivos, você monta sua página sem escrever código. Crie o site da sua consultoria em poucos minutos.',
        ctaLabel: 'Comece agora',
        ctaHref: '#footer',
        imageUrl: '/landing-page-templates/consultation/hero-bg.png',
      },
    },
    {
      type: 'FACTS',
      content: {
        type: 'FACTS',
        items: [
          { value: '1M+', label: 'Clientes nos visitam todos os meses' },
          { value: '93%', label: 'Índice de satisfação dos nossos clientes.' },
          { value: '4.9', label: 'Nota média dos clientes, em 5,00!' },
        ],
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
            description: '',
            imageUrl:
              '/landing-page-templates/consultation/services-digital-marketing.png',
          },
          {
            title: 'Produção de Conteúdo',
            description: '',
            imageUrl:
              '/landing-page-templates/consultation/services-content-writing.png',
          },
          {
            title: 'Design Gráfico',
            description: '',
            imageUrl:
              '/landing-page-templates/consultation/services-graphic-design.png',
          },
          {
            title: 'SEO para Empresas',
            description: '',
            imageUrl: '/landing-page-templates/consultation/services-seo.png',
          },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Por que escolher a gente?',
        subtitle:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        imageUrl:
          '/landing-page-templates/consultation/steps-video-preview.png',
        items: [
          {
            title: 'Agendamento Fácil',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código.',
          },
          {
            title: 'Opinião Gratuita de Especialistas',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código.',
          },
          {
            title: 'Receba Seus Resultados',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código.',
          },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Vocês deixaram tudo muito simples. Meu novo site ficou bem mais rápido e fácil de usar.',
        authorName: 'Ilya Vasin',
        authorRole: 'Engenheiro de Software',
        avatarUrl:
          '/landing-page-templates/consultation/testimonial-logo-amazon.png',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Leitura indispensável para estudantes que querem ser grandes Product Designers.',
        authorName: 'Mariano Rasgado',
        authorRole: 'Engenheiro de Software',
        avatarUrl:
          '/landing-page-templates/consultation/testimonial-logo-google.png',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Vocês deixaram tudo muito simples. Meu novo site ficou bem mais rápido e fácil de usar.',
        authorName: 'Oka Tomoaki',
        authorRole: 'Engenheiro de Software',
        avatarUrl:
          '/landing-page-templates/consultation/testimonial-logo-amazon.png',
        style: 'default',
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title:
          'Receba agora uma consultoria gratuita com nossos especialistas!',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page rapidinho.',
        imageUrls: [],
      },
    },
    {
      type: 'NEWSLETTER',
      content: {
        type: 'NEWSLETTER',
        title: 'Assine nossa newsletter e receba as novidades no seu e-mail.',
        placeholder: 'Digite seu e-mail',
        ctaLabel: 'Assinar',
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
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
          {
            title: 'Fale conosco',
            links: [
              {
                label: 'contato@suaempresa.com.br',
                href: 'mailto:contato@suaempresa.com.br',
              },
              { label: '+133-394-3439-1435', href: 'tel:+13339343439' },
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
