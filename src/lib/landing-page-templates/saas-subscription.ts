import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "02-SaaS Subscription" do kit Figma de referência
 * (node 0:2385). Ordem de seções segue o fluxo vertical real do frame:
 * Header → Hero → Features → Content 01 ("Getting started...") → Facts →
 * Content 02 ("Manage your projects...") → Testimonial (x2) → Pricing →
 * FAQ → CTA → Footer.
 *
 * Content 01 e Content 02 mapeiam pro mesmo tipo STEPS — o primeiro com
 * `items` vazio (texto + imagem + CTA fixo, sem lista numerada) e o segundo
 * com a lista de 3 passos; `SaasSubscriptionSteps` decide o layout com base
 * em `items.length`. O bloco "CTA" (título + 2 botões) foi dobrado nos
 * campos `ctaTitle/ctaDescription/ctaLabel/ctaHref` do FOOTER, como o
 * próprio schema já sugere pro padrão Features/Footer.
 */
export const saasSubscriptionTemplate: LandingPageTemplateDefinition = {
  key: 'saas-subscription',
  name: 'Assinatura de software (SaaS)',
  description: 'Modelo para produtos SaaS com planos e assinatura.',
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
        ctaLabel: 'Comece grátis',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        title: 'Entregue resultados com um time remoto incrível',
        subtitle:
          'Compartilhamos tendências e estratégias para você aumentar sua receita e continuar sempre em alta demanda.',
        ctaLabel: 'Comece grátis',
        ctaHref: '#footer',
        imageUrl: '/landing-page-templates/saas-subscription/hero-mockup.png',
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Tudo o que você precisa para gerenciar projetos',
        items: [
          {
            title: 'Gestão de projetos',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Controle de horas',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Aplicativo mobile elegante',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Começar com o Albino nunca foi tão fácil',
        subtitle:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page rapidamente com o Albino.',
        imageUrl: '/landing-page-templates/saas-subscription/steps1-user-1.png',
        items: [],
      },
    },
    {
      type: 'FACTS',
      content: {
        type: 'FACTS',
        items: [
          { value: '1M+', label: 'Clientes visitam o Albino todo mês' },
          { value: '93%', label: 'Índice de satisfação dos nossos clientes.' },
          { value: '4.9', label: 'Avaliação média dos clientes, em 5,00!' },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Gerencie seus projetos com rapidez',
        subtitle:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
        imageUrl: '/landing-page-templates/saas-subscription/steps2-event.png',
        items: [
          {
            title: 'Crie um projeto',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código.',
          },
          {
            title: 'Atribua as pessoas envolvidas',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código.',
          },
          {
            title: 'Entregue dentro do prazo',
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
          '“Vocês deixaram tudo muito simples.” Meu novo site é muito mais rápido e fácil de usar que o antigo.',
        authorName: 'Corey Valdez',
        authorRole: 'Fundador na Zenix',
        avatarUrl:
          '/landing-page-templates/saas-subscription/testimonial-avatar-1.png',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          '“Simplesmente o melhor.” Superior a todos os outros. Eu recomendaria este produto para iniciantes.',
        authorName: 'Ian Klein',
        authorRole: 'Profissional de marketing digital',
        avatarUrl:
          '/landing-page-templates/saas-subscription/testimonial-avatar-2.png',
        style: 'spotlight',
      },
    },
    {
      type: 'PRICING',
      content: {
        type: 'PRICING',
        title: 'Planos e preços',
        subtitle:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
        plans: [
          {
            name: 'Básico',
            price: 'R$ 29',
            period: 'Pagamento único',
            features: [
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
            ],
            ctaLabel: 'Comece grátis',
            ctaHref: '#footer',
            highlighted: false,
          },
          {
            name: 'Padrão',
            price: 'R$ 49',
            period: 'Pagamento único',
            features: [
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
            ],
            ctaLabel: 'Comece grátis',
            ctaHref: '#footer',
            highlighted: false,
          },
          {
            name: 'Premium',
            price: 'R$ 99',
            period: 'Pagamento único',
            features: [
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
            ],
            ctaLabel: 'Comece grátis',
            ctaHref: '#footer',
            highlighted: false,
          },
        ],
      },
    },
    {
      type: 'FAQ',
      content: {
        type: 'FAQ',
        title: 'Perguntas frequentes',
        items: [
          {
            question: 'Posso usar o Albino para os meus clientes?',
            answer:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
          },
          {
            question: 'Funciona com WordPress?',
            answer:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
          },
          {
            question: 'Recebo atualizações gratuitas?',
            answer:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
          },
          {
            question: 'Vocês oferecem suporte?',
            answer:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
          },
        ],
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        logoText: 'Sua Empresa',
        text: 'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
        ctaTitle: 'Crie landing pages melhores, mais rápido',
        ctaDescription:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
        ctaLabel: 'Quero agora',
        ctaHref: '#footer',
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
              { label: 'Marketing digital', href: '#' },
              { label: 'Redação de conteúdo', href: '#' },
              { label: 'SEO para empresas', href: '#' },
              { label: 'Design de interface', href: '#' },
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
