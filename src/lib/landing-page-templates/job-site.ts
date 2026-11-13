import type { LandingPageTemplateDefinition } from './index'

/**
 * Fiel ao frame "04-Job Site" do kit Figma de referência (node 0:1950,
 * mesmo kit "Brainwave.io" do template Agency). Ordem de seções segue o
 * fluxo vertical real do frame: Header (sobreposto ao Hero) → Hero (com
 * formulário de busca) → Company (logos) → Category (categorias de vaga) →
 * Content (3 passos) → Jobs (vagas em destaque) → News (notícias) →
 * Subscribe (newsletter) → Footer.
 *
 * O frame tem dois blocos "WORKS" (Jobs e News) — o componente
 * `JobSiteWorks` (ver `sections/job-site/works.tsx`) resolve o layout de
 * cada card sozinho a partir de `category`, então os dois blocos convivem
 * no mesmo tipo de seção sem precisar estender o schema.
 */
export const jobSiteTemplate: LandingPageTemplateDefinition = {
  key: 'job-site',
  name: 'Portal de vagas',
  description: 'Modelo para portais de vagas e recrutamento.',
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
          { label: 'Entrar', href: '#' },
        ],
        ctaLabel: 'Cadastre-se',
        ctaHref: '#subscribe',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        title: 'Encontre o emprego dos sonhos que muda vidas.',
        subtitle:
          'Com blocos prontos, você monta o seu portal de vagas facilmente, sem escrever código.',
        ctaLabel: 'Buscar',
        ctaHref: '#jobs',
        imageUrl: '/landing-page-templates/job-site/hero-portrait.png',
      },
    },
    {
      type: 'LOGOS',
      content: {
        type: 'LOGOS',
        title: 'Grandes empresas estão aqui',
        logos: [
          {
            name: 'MakeLess',
            imageUrl: '/landing-page-templates/job-site/logo-makeless.png',
          },
          {
            name: 'coworks',
            imageUrl: '/landing-page-templates/job-site/logo-coworks.png',
          },
          {
            name: 'greener',
            imageUrl: '/landing-page-templates/job-site/logo-greener.png',
          },
          {
            name: 'SAAS TODAY',
            imageUrl: '/landing-page-templates/job-site/logo-saastoday.png',
          },
          {
            name: 'Dorfus',
            imageUrl: '/landing-page-templates/job-site/logo-dorfus.png',
          },
          {
            name: 'askimat',
            imageUrl: '/landing-page-templates/job-site/logo-askimat.png',
          },
        ],
      },
    },
    {
      type: 'SERVICES',
      content: {
        type: 'SERVICES',
        title: 'Vagas por categoria',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
        items: [
          { title: 'Design', description: '47 vagas' },
          { title: 'Marketing', description: '51 vagas' },
          { title: 'Engenharia', description: '89 vagas' },
          { title: 'Gestão', description: '16 vagas' },
          { title: 'Finanças', description: '23 vagas' },
          { title: 'Atendimento ao cliente', description: '34 vagas' },
        ],
      },
    },
    {
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Encontre vagas em 3 passos simples',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
        imageUrl: '/landing-page-templates/job-site/content-photo.png',
        items: [
          {
            title: 'Busque uma vaga',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
          {
            title: 'Candidate-se pelo site',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
          {
            title: 'Receba o convite para entrevista',
            description:
              'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
          },
        ],
      },
    },
    {
      type: 'WORKS',
      content: {
        type: 'WORKS',
        title: 'Vagas em destaque',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
        items: [
          {
            title: 'Engenheiro(a) de Software Sênior — Dorfus, São Paulo, SP',
            category: 'Tempo integral',
            imageUrl: '/landing-page-templates/job-site/job-logo-dorfus.png',
          },
          {
            title: 'Designer de Produto — Coworks, Curitiba, PR',
            category: 'Remoto',
            imageUrl: '/landing-page-templates/job-site/job-logo-coworks.svg',
          },
          {
            title: 'Designer de UX — Askimat, Florianópolis, SC',
            category: 'Tempo integral',
            imageUrl: '/landing-page-templates/job-site/job-logo-askimat.png',
          },
          {
            title: 'Desenvolvedor(a) Web Full-stack — Greener, Belo Horizonte, MG',
            category: 'Meio período',
            imageUrl: '/landing-page-templates/job-site/job-logo-greener.svg',
          },
        ],
      },
    },
    {
      type: 'WORKS',
      content: {
        type: 'WORKS',
        title: 'Notícias que ajudam',
        subtitle:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
        items: [
          {
            title: 'Como conquistar a vaga que você quer em 5 passos.',
            category: 'Carreira',
            imageUrl: '/landing-page-templates/job-site/news-1.png',
          },
          {
            title: '10 formas de reduzir o desânimo no trabalho de escritório.',
            category: 'Estilo de vida',
            imageUrl: '/landing-page-templates/job-site/news-2.png',
          },
          {
            title: 'Por que trabalhar em equipe até nos projetos pequenos.',
            category: 'Carreira',
            imageUrl: '/landing-page-templates/job-site/news-3.png',
          },
        ],
      },
    },
    {
      type: 'NEWSLETTER',
      content: {
        type: 'NEWSLETTER',
        title: 'Receba nossas novidades',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
        placeholder: 'Digite o seu e-mail',
        ctaLabel: 'Inscrever-se',
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        logoText: 'Sua Empresa',
        text: 'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
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
              { label: 'SEO para negócios', href: '#' },
              { label: 'Design de interface', href: '#' },
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
