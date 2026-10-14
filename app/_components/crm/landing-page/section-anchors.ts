import type { CrmLandingPageSectionType } from '@/src/schemas/crm-landing-page-section.schema'

/**
 * In-page anchors for landing-page links ("#servicos" jumps to the services
 * block). The public render wraps every enabled section in an element with
 * this id, and the link editor lists the same targets, so a link set from
 * the editor always lands on a section that exists. pt-BR slugs on purpose:
 * the ids show in the visitor's URL, and they never collide with the English
 * ids some Figma ports hardcode on inner elements (`#footer`, `#facts`).
 */
const SECTION_ANCHOR: Record<
  CrmLandingPageSectionType,
  { slug: string; label: string }
> = {
  HEADER: { slug: 'cabecalho', label: 'Cabeçalho' },
  HERO: { slug: 'destaque', label: 'Destaque' },
  SERVICES: { slug: 'servicos', label: 'Serviços' },
  FACTS: { slug: 'numeros', label: 'Números' },
  ABOUT: { slug: 'sobre', label: 'Sobre' },
  TESTIMONIAL: { slug: 'depoimentos', label: 'Depoimento' },
  FEATURES: { slug: 'diferenciais', label: 'Diferenciais' },
  WORKS: { slug: 'projetos', label: 'Projetos' },
  FOOTER: { slug: 'rodape', label: 'Rodapé' },
  PRICING: { slug: 'precos', label: 'Preços' },
  FAQ: { slug: 'perguntas-frequentes', label: 'Perguntas frequentes' },
  STEPS: { slug: 'como-funciona', label: 'Como funciona' },
  NEWSLETTER: { slug: 'newsletter', label: 'Newsletter' },
  LOGOS: { slug: 'logos', label: 'Logos' },
  PRODUCTS: { slug: 'produtos', label: 'Produtos' },
}

export type SectionAnchor = { id: string; label: string }

/**
 * One anchor per section, in page order. A type that repeats gets a numeric
 * suffix from its second occurrence on (`depoimentos`, `depoimentos-2`).
 */
export function sectionAnchors(
  sections: { type: CrmLandingPageSectionType }[],
): SectionAnchor[] {
  const seen = new Map<CrmLandingPageSectionType, number>()
  return sections.map((section) => {
    const count = (seen.get(section.type) ?? 0) + 1
    seen.set(section.type, count)
    const { slug, label } = SECTION_ANCHOR[section.type]
    return count === 1
      ? { id: slug, label }
      : { id: `${slug}-${count}`, label: `${label} ${count}` }
  })
}
