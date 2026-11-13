import type { LandingPageTemplateDefinition } from './index'

const BASE = '/landing-page-templates/web-application'

/**
 * Fiel ao frame "05-Web Application" do kit Figma de referência (node
 * 0:1371, mesmo arquivo "Brainwave.io" do template Agency). Ordem de seções
 * segue o fluxo vertical real do frame: Header (sobreposto ao Hero) → Hero
 * → Logos → Features → Content 01 → Content 02 → Content 03 → Pricing →
 * Testimonial (2x) → Footer.
 *
 * Mapeamento pros 15 tipos do vocabulário compartilhado
 * (`src/schemas/crm-landing-page-section.schema.ts`):
 * - Content 01 e Content 03 (texto + imagem, imagem à esquerda) → ABOUT,
 *   duas vezes.
 * - Content 02 (texto + imagem, imagem à direita — layout espelhado) →
 *   STEPS, com `items: []` (não é uma lista numerada no Figma).
 * - O bloco "Testimonial" do Figma tem 2 depoimentos lado a lado num grid
 *   2 colunas — viram duas seções TESTIMONIAL (`style: 'default'`)
 *   sequenciais, empilhadas verticalmente (ver comentário em
 *   `sections/web-application/testimonial.tsx`).
 */
export const webApplicationTemplate: LandingPageTemplateDefinition = {
  key: 'web-application',
  name: 'Aplicação web',
  description: 'Modelo para SaaS e aplicações web.',
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
        ctaLabel: 'Teste grátis',
        ctaHref: '#footer',
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        title: 'Mais visitantes, mais vendas.',
        subtitle:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie seu próximo site em poucos minutos.',
        ctaLabel: 'Teste grátis',
        ctaHref: '#footer',
        imageUrl: `${BASE}/hero-video.png`,
      },
    },
    {
      type: 'LOGOS',
      content: {
        type: 'LOGOS',
        logos: [
          { name: 'MakeLess', imageUrl: `${BASE}/logo-1.png` },
          { name: 'coworks', imageUrl: `${BASE}/logo-2.png` },
          { name: 'greener', imageUrl: `${BASE}/logo-3.png` },
          { name: 'SaaS Today', imageUrl: `${BASE}/logo-4.png` },
          { name: 'Dorfus', imageUrl: `${BASE}/logo-5.png` },
          { name: 'askimat', imageUrl: `${BASE}/logo-6.png` },
        ],
      },
    },
    {
      type: 'FEATURES',
      content: {
        type: 'FEATURES',
        title: 'Organize suas campanhas',
        items: [
          {
            title: 'Organize suas campanhas',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Gerencie clientes',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
          {
            title: 'Acompanhe o progresso com agilidade',
            description:
              'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
          },
        ],
      },
    },
    {
      // Content 01 — imagem (laptop mockup) à esquerda, texto à direita.
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Acompanhe seu progresso com nosso site avançado.',
        description:
          'Compartilhamos tendências e estratégias para você aumentar sua receita e continuar sempre em alta demanda.',
        imageUrl: `${BASE}/content-01-laptop.png`,
        imageUrls: [],
      },
    },
    {
      // Content 02 — texto à esquerda, imagem à direita (layout espelhado).
      type: 'STEPS',
      content: {
        type: 'STEPS',
        title: 'Entenda seus visitantes rápido. Aja com agilidade.',
        subtitle:
          'Compartilhamos tendências e estratégias para você aumentar sua receita e continuar sempre em alta demanda.',
        imageUrl: `${BASE}/content-02-front.png`,
        items: [],
      },
    },
    {
      // Content 03 — colagem de fotos à esquerda, texto à direita.
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Encante seus clientes com um ótimo atendimento.',
        description:
          'Compartilhamos tendências e estratégias para você aumentar sua receita e continuar sempre em alta demanda.',
        imageUrl: `${BASE}/content-03-photo-1.png`,
        imageUrls: [
          `${BASE}/content-03-photo-2.png`,
          `${BASE}/content-03-photo-3.png`,
        ],
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
            name: 'Inicial',
            price: 'R$ 19',
            period: '/ mês',
            features: [
              'Licença comercial',
              'Mais de 100 elementos de interface',
              'Suporte a 1 domínio',
            ],
            ctaLabel: 'Teste grátis',
            highlighted: false,
          },
          {
            name: 'Padrão',
            price: 'R$ 49',
            period: '/ mês',
            features: [
              'Licença comercial',
              'Mais de 100 elementos de interface',
              'Suporte a domínios ilimitados',
              '6 meses de suporte premium',
            ],
            ctaLabel: 'Teste grátis',
            highlighted: true,
          },
          {
            name: 'Premium',
            price: 'R$ 99',
            period: '/ mês',
            features: [
              'Licença comercial',
              'Mais de 100 elementos de interface',
              'Suporte a domínios ilimitados',
              '6 meses de suporte premium',
              'Atualizações vitalícias',
            ],
            ctaLabel: 'Teste grátis',
            highlighted: false,
          },
        ],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Uau! Não acredito que ganhei uma landing page totalmente nova com o Omega. Foi super fácil de editar e publicar.',
        authorName: 'Diego Morata',
        authorRole: 'Desenvolvedor web',
        style: 'default',
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Simplesmente o melhor. Superior a todos os outros. Eu recomendaria este produto para iniciantes e usuários avançados.',
        authorName: 'Franklin Hicks',
        authorRole: 'Profissional de marketing digital',
        style: 'default',
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
          {
            title: 'Fale conosco',
            links: [
              {
                label: 'contato@suaempresa.com.br',
                href: 'mailto:contato@suaempresa.com.br',
              },
              { label: '+133-394-3439-1435', href: 'tel:+13393943439' },
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
