import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "03-Coworking" do kit Figma de referência (node 0:2226,
 * mesmo arquivo "Brainwave.io"). Ordem de seções segue o fluxo vertical real
 * do frame: Hero (com formulário de busca) → Facts → Locations → Content 01
 * → Features → Content 02 → Subscribe → Footer. O frame original agrupa
 * "Content 02" (lista de benefícios + accordion de FAQ) numa única seção
 * lado a lado — aqui vira duas seções independentes (STEPS + FAQ), já que o
 * vocabulário de tipos não tem um "duas colunas" dedicado; ambas mantêm o
 * fundo escuro pra preservar a leitura visual do bloco original (ver
 * comentários em `steps.tsx`/`faq.tsx`).
 */
export const coworkingTemplate: LandingPageTemplateDefinition = {
  key: 'coworking',
  name: 'Coworking',
  description: 'Modelo para espaços de coworking e escritórios compartilhados.',
  sections: [
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        eyebrow: 'Espaço compartilhado na sua cidade',
        title: 'Alugue uma mesa em um escritório compartilhado',
        ctaLabel: 'Buscar espaço',
        ctaHref: '#locations',
        imageUrl: '/landing-page-templates/coworking/hero-bg.jpg',
      },
    },
    {
      type: 'FACTS',
      content: {
        type: 'FACTS',
        items: [
          {
            value: '06',
            label: 'Escritórios disponíveis em diferentes países',
          },
          {
            value: '238',
            label: 'Lugares disponíveis agora, com suporte dedicado',
          },
          {
            value: '1,395',
            label: 'Pessoas usando nossos espaços de coworking agora',
          },
        ],
      },
    },
    {
      type: 'WORKS',
      content: {
        type: 'WORKS',
        title: 'Locais mais procurados',
        subtitle:
          'Com vários blocos prontos, você monta sua página facilmente, sem escrever código.',
        items: [
          {
            title: 'Beauview',
            category: '37 lugares',
            imageUrl: '/landing-page-templates/coworking/location-1.jpg',
          },
          {
            title: 'Haleyborough',
            category: '12 lugares',
            imageUrl: '/landing-page-templates/coworking/location-2.jpg',
          },
          {
            title: 'Jeromyshire',
            category: '28 lugares',
            imageUrl: '/landing-page-templates/coworking/location-3.jpg',
          },
        ],
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Trabalhe ao lado de pessoas muito talentosas.',
        description:
          'Com vários blocos prontos, você monta sua página facilmente, sem escrever código.',
        imageUrl: '/landing-page-templates/coworking/about-photo-1.jpg',
        imageUrls: ['/landing-page-templates/coworking/about-photo-2.jpg'],
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Tudo o que você precisa',
        items: [
          {
            title: 'Mesa Dedicada',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Internet de Alta Velocidade',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Café à Vontade',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
          },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Estamos sempre aqui para apoiar você.',
        subtitle:
          'Compartilhamos tendências e estratégias para criar e aumentar a sua receita com locação.',
        items: [
          {
            title: 'Locais Sem Barulho',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código.',
          },
          {
            title: 'Suporte 24 Horas, 7 Dias por Semana',
            description:
              'Com vários blocos prontos, você monta sua página sem escrever código.',
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
            question: 'Como configurar a Sua Empresa?',
            answer:
              'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page. Integer ut obe ryn. Sed feugiat vitae turpis a porta.',
          },
          {
            question: 'Posso usar a Sua Empresa para os meus clientes?',
            answer: '',
          },
          {
            question: 'Com que frequência vocês lançam atualizações?',
            answer: '',
          },
          {
            question: 'Como acesso uma versão antiga?',
            answer: '',
          },
        ],
      },
    },
    {
      type: 'NEWSLETTER',
      content: {
        type: 'NEWSLETTER',
        title: 'Receba as últimas novidades',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
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
              { label: '+133-394-3439-1435', href: 'tel:+13339433439-1435' },
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
