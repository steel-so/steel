import type { LandingPageTemplateDefinition } from './index'

const BASE = '/landing-page-templates/ecommerce'

/**
 * Fiel ao frame "06-ECommerce" do kit Figma de referência (node 0:1102).
 * Ordem de seções segue o fluxo vertical real do frame: Header → Hero →
 * Category → All Items → Content → Testimonial → CTA → Footer.
 *
 * Duas seções do frame não têm tipo dedicado no vocabulário atual de 9
 * tipos (`src/schemas/crm-landing-page-section.schema.ts` só cobre HEADER,
 * HERO, SERVICES, FACTS, ABOUT, TESTIMONIAL, FEATURES, WORKS, FOOTER — não
 * o PRODUCTS citado no briefing original do template):
 * - "Category" (6 cards de cômodo) e "All Items" (8 produtos) usam WORKS
 *   duas vezes — preço/preço original de cada produto ficam no campo
 *   `category` como `"$preço|$preço original"`, que o componente
 *   `EcommerceWorks` interpreta (ver `sections/ecommerce/works.tsx`).
 * - "CTA" (banner full-bleed antes do rodapé) foi absorvido nos campos
 *   ctaTitle/ctaLabel/ctaHref de FOOTER, com a foto de fundo fixa no
 *   componente `EcommerceFooter`.
 */
export const ecommerceTemplate: LandingPageTemplateDefinition = {
  key: 'ecommerce',
  name: 'Loja virtual',
  description: 'Modelo para lojas de móveis e decoração.',
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
      },
    },
    {
      type: 'HERO',
      content: {
        type: 'HERO',
        eyebrow: 'Design de interiores minimalista',
        title: 'Menos desperdício em cada etapa do seu projeto.',
        imageUrl: `${BASE}/hero-bg.png`,
      },
    },
    {
      type: 'WORKS',
      content: {
        type: 'WORKS',
        title: 'Compre por ambiente',
        subtitle: 'Categorias',
        items: [
          {
            title: 'Sala de estar',
            category: '23 itens',
            imageUrl: `${BASE}/category-living-room.png`,
          },
          {
            title: 'Sala de jantar',
            category: '36 itens',
            imageUrl: `${BASE}/category-dining-room.png`,
          },
          {
            title: 'Quarto',
            category: '17 itens',
            imageUrl: `${BASE}/category-bed-room.png`,
          },
          {
            title: 'Cozinha',
            category: '11 itens',
            imageUrl: `${BASE}/category-kitchen.png`,
          },
          {
            title: 'Escritório',
            category: '09 itens',
            imageUrl: `${BASE}/category-office.png`,
          },
          {
            title: 'Área externa',
            category: '45 itens',
            imageUrl: `${BASE}/category-outdoor.png`,
          },
        ],
      },
    },
    {
      type: 'PRODUCTS',
      content: {
        type: 'PRODUCTS',
        title: 'Conheça todos os produtos',
        items: [
          {
            title: 'Poltrona Couture',
            price: 'R$ 899',
            originalPrice: 'R$ 1.350',
            imageUrl: `${BASE}/product-safavieh-couture.png`,
          },
          {
            title: 'Pufe Artesanal',
            price: 'R$ 34',
            imageUrl: `${BASE}/product-fair-trade-ghana.png`,
          },
          {
            title: 'Mesa Redonda',
            price: 'R$ 44,99',
            imageUrl: `${BASE}/product-kingso-round-table.png`,
          },
          {
            title: 'Cadeira de Jantar',
            price: 'R$ 120',
            originalPrice: 'R$ 350',
            imageUrl: `${BASE}/product-porthos-dining-chair.png`,
          },
          {
            title: 'Banqueta Dobrável',
            price: 'R$ 31,49',
            imageUrl: `${BASE}/product-trade-folding-stool.png`,
          },
          {
            title: 'Poltrona Rivet',
            price: 'R$ 120',
            originalPrice: 'R$ 350',
            imageUrl: `${BASE}/product-rivet-accent-chair.png`,
          },
          {
            title: 'Cadeira Living',
            price: 'R$ 110',
            originalPrice: 'R$ 350',
            imageUrl: `${BASE}/product-armen-living-chair.png`,
          },
          {
            title: 'Cadeira Knight',
            price: 'R$ 120',
            originalPrice: 'R$ 350',
            imageUrl: `${BASE}/product-knight-chair.png`,
          },
        ],
      },
    },
    {
      type: 'ABOUT',
      content: {
        type: 'ABOUT',
        title: 'Acompanhe seu pedido de ponta a ponta.',
        description:
          'Compartilhamos tendências e estratégias para valorizar seus ambientes e manter a sua casa sempre em alta.',
        imageUrl: `${BASE}/content-photo-main.png`,
        imageUrls: [`${BASE}/content-photo-float.png`],
      },
    },
    {
      type: 'TESTIMONIAL',
      content: {
        type: 'TESTIMONIAL',
        quote:
          'Uau! Nem acredito que ganhei um quarto novinho depois de contratar vocês. Foi superfácil comprar e começar.',
        authorName: 'Maria José Botín',
        authorRole: 'Designer de interiores',
        avatarUrl: `${BASE}/testimonial-avatar.png`,
        style: 'default',
      },
    },
    {
      type: 'FOOTER',
      content: {
        type: 'FOOTER',
        ctaTitle: 'Pronto para decorar a sua casa?',
        ctaLabel: 'Começar a comprar',
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
          {
            title: 'Fale conosco',
            links: [
              {
                label: 'contato@suaempresa.com.br',
                href: 'mailto:contato@suaempresa.com.br',
              },
              { label: '+133-394-3439-1435', href: 'tel:+13339434391435' },
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
