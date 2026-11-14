import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "07-Mobile App" do kit Figma de referência (node 0:421).
 * Ordem de seções segue o fluxo vertical real do frame: Header → Hero →
 * Content 01 → Content 02 → How → Video → Testimonial (3 cards) →
 * Features → Pricing → Footer.
 *
 * Gaps de vocabulário (ver relatório da tarefa):
 * - Não existe um tipo dedicado a vídeo — o banner "Video" (imagem +
 *   botão de play decorativo) usa STEPS com `items: []`.
 * - Content 01/02 (texto + imagem + lista de 2 itens) também usam STEPS —
 *   é o tipo que mais preserva a estrutura (título + subtítulo + imagem +
 *   itens); o componente decide o layout pela forma do conteúdo (ver
 *   `sections/mobile-app/steps.tsx`).
 * - O bloco "Testimonial" do Figma é 1 heading + 3 cards empilhados sobre
 *   um fundo escuro contínuo com Features. Como TESTIMONIAL só carrega um
 *   card por seção, viraram 3 seções TESTIMONIAL consecutivas com o mesmo
 *   fundo escuro — a costura entre elas fica invisível, mas o heading
 *   compartilhado ("1,749 remote teams...") e o link "Read more reviews"
 *   não têm campo correspondente e foram omitidos.
 */
export const mobileAppTemplate: LandingPageTemplateDefinition = {
  key: 'mobile-app',
  name: 'Aplicativo',
  description: 'Modelo para apps mobile e produtos SaaS de equipe remota.',
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
        ctaLabel: 'Começar agora',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        title: 'Gerencie o trabalho da sua equipe remota',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Publique seu site em poucos minutos.',
        ctaLabel: 'Saiba mais',
        ctaHref: '#footer',
        imageUrl: '/landing-page-templates/mobile-app/hero-app-mockup.png',
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Colabore com os membros da equipe.',
        subtitle:
          'Compartilhamos tendências e estratégias para melhorar os seus resultados.',
        imageUrl: '/landing-page-templates/mobile-app/content-collaborate.png',
        items: [
          {
            title: 'Grupos por projeto',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
          {
            title: 'Reuniões em vídeo ilimitadas',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Organize a equipe remota com rapidez e facilidade.',
        subtitle:
          'Compartilhamos tendências e estratégias para criar e melhorar os seus resultados.',
        imageUrl: '/landing-page-templates/mobile-app/content-organize.png',
        items: [
          {
            title: 'Crie equipes ilimitadas',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
          {
            title: 'Converse com todos sem complicação',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Como funciona?',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever nenhum código.',
        items: [
          { title: 'Instale o app', description: '' },
          { title: 'Adicione os membros da equipe', description: '' },
          { title: 'É só começar!', description: '' },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Assista a uma demonstração do app',
        imageUrl: '/landing-page-templates/mobile-app/video-banner.png',
        items: [],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Uau! Nem acredito que ganhei uma página nova depois de usar o Ômega. Foi superfácil de editar e publicar.',
        authorName: 'Isaac Olson',
        avatarUrl:
          '/landing-page-templates/mobile-app/testimonial-avatar-1.png',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Simplesmente o melhor, bem acima dos concorrentes. Recomendo para iniciantes e para usuários avançados que querem resultado.',
        authorName: 'Barry Young',
        avatarUrl:
          '/landing-page-templates/mobile-app/testimonial-avatar-2.png',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Leitura obrigatória para quem quer ser Designer de Produto ou de Interação.',
        authorName: 'Esther Allison',
        avatarUrl:
          '/landing-page-templates/mobile-app/testimonial-avatar-3.png',
        style: 'default',
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Criamos este app para resolver os seus problemas.',
        items: [
          {
            title: 'Projetos ilimitados',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
          {
            title: 'Gestão de equipes',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
          {
            title: 'Compartilhamento de arquivos',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
          {
            title: 'Reuniões em vídeo',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
          {
            title: 'Controle de horas',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
          {
            title: 'Sistema de pagamentos',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
          },
        ],
      },
    },
    {
      type: 'PRICING',
      content: {
        type: 'PRICING',
        title: 'Preços descomplicados',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever nenhum código.',
        plans: [
          {
            name: 'Inicial',
            price: 'R$ 19',
            period: '/ mês',
            features: [
              'Até 100 membros na equipe',
              '100 GB de armazenamento',
              'Reuniões ilimitadas',
              'Suporte premium',
            ],
            ctaLabel: 'Começar agora',
            ctaHref: '#footer',
            highlighted: false,
          },
          {
            name: 'Ilimitado',
            price: 'R$ 99',
            period: '/ mês',
            features: [
              'Membros ilimitados na equipe',
              'Armazenamento ilimitado',
              'Reuniões ilimitadas',
              'Suporte premium',
            ],
            ctaLabel: 'Começar agora',
            ctaHref: '#footer',
            highlighted: true,
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
            title: 'Legal',
            links: [
              { label: 'Política de privacidade', href: '#' },
              { label: 'Termos e condições', href: '#' },
              { label: 'Política de devolução', href: '#' },
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
