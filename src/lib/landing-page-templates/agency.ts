import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "01-Agency" do kit Figma de referência (node 0:2555, página
 * "🤩 02. Landing Page"). Ordem de seções segue o fluxo vertical real do
 * frame: Header (sobreposto ao Hero) → Hero → Services → Testimonial →
 * About → Facts → Features → Works → Testimonial → Footer. O frame tem dois
 * blocos de Testimonial — por isso o tipo aparece duas vezes.
 */
export const agencyTemplate: LandingPageTemplateDefinition = {
  key: 'agency',
  name: 'Agência',
  description: 'Modelo para agências criativas e estúdios de design.',
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
        ctaLabel: 'Iniciar um projeto',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        eyebrow: 'Vamos transformar o seu negócio',
        title: 'Acelere o seu negócio com a Sua Empresa.',
        subtitle:
          'Com vários blocos exclusivos, você monta sua página sem escrever código. Crie o site da sua consultoria em poucos minutos.',
        ctaLabel: 'Iniciar um projeto',
        ctaHref: '#footer',
        imageUrl: '/landing-page-templates/agency/hero-portrait.png',
      },
    },
    {
      type: 'SERVICES',
      content: {
        type: 'SERVICES',
        title: 'Entregamos serviços de excelência, sob medida para cada cliente',
        items: [
          {
            title: 'Design Gráfico',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Desenvolvimento Web',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Produção de Conteúdo',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Uau! Nem acredito que ganhei uma landing page nova. Foi muito fácil de editar e publicar.',
        authorName: 'Franklin Hicks',
        authorRole: 'Desenvolvedor Web',
        avatarUrl: '/landing-page-templates/agency/testimonial-avatar-1.png',
        style: 'default',
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        eyebrow: 'Nossa história',
        title:
          'Sabemos como tudo funciona e por que o seu negócio não decola.',
        description:
          'Compartilhamos tendências e estratégias para aumentar a sua receita e manter a sua empresa sempre em alta demanda. Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        imageUrl: '/landing-page-templates/agency/about-photo-main.png',
        imageUrls: [
          '/landing-page-templates/agency/about-photo-2.png',
          '/landing-page-templates/agency/about-photo-3.png',
        ],
      },
    },
    {
      type: 'FACTS',
      content: {
        type: 'FACTS',
        items: [
          {
            value: '1M+',
            label: 'Clientes nos procuram todo mês para resolver suas demandas.',
          },
          {
            value: '92%',
            label: 'Índice de satisfação dos nossos clientes incríveis.',
          },
          {
            value: '4.9/5.0',
            label: 'Nota média que recebemos dos clientes em toda a internet.',
          },
        ],
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'As pessoas nos escolhem porque entregamos o melhor para todos',
        subtitle: 'Por que nos escolher',
        items: [
          {
            title: 'Gerente de projeto dedicado',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Tarefas organizadas',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Feedback sem complicação',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Prazos sempre cumpridos',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
        ],
        ctaTitle: 'Pronto para lançar o seu próximo projeto?',
        ctaDescription:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        ctaLabel: 'Iniciar um projeto',
        ctaHref: '#footer',
      },
    },
    {
      type: 'WORKS',
      content: {
        type: 'WORKS',
        title: 'Nossos trabalhos mostram por que somos referência no mercado',
        subtitle: 'Estudos de caso',
        items: [
          {
            title: 'Identidade Visual Aura',
            category: 'Design Gráfico',
            imageUrl: '/landing-page-templates/agency/work-1.png',
          },
          {
            title: 'Embalagem de Snacks AB.S',
            category: 'Design Gráfico',
            imageUrl: '/landing-page-templates/agency/work-3.png',
          },
          {
            title: 'Site Gradient',
            category: 'Desenvolvimento Web',
            imageUrl: '/landing-page-templates/agency/work-2.png',
          },
          {
            title: 'Conteúdo para Revista',
            category: 'Produção de Conteúdo',
            imageUrl: '/landing-page-templates/agency/work-4.png',
          },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Simplesmente o melhor, muito acima dos concorrentes. Recomendo para iniciantes e para usuários avançados.',
        authorName: 'Ian Klein',
        authorRole: 'Profissional de Marketing Digital',
        avatarUrl: '/landing-page-templates/agency/testimonial-avatar-2.png',
        style: 'spotlight',
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        logoText: 'Brainwave.io',
        text: 'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        ctaTitle: 'Pronto para lançar o seu próximo projeto?',
        ctaDescription:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
        ctaLabel: 'Iniciar um projeto',
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
