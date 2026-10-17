import type { DevSectionSlug } from '@/src/schemas/dev-page.schema'

export interface DevSection {
  slug: DevSectionSlug
  label: string
  description: string
}

/** Labels and blurbs of the developer site's sidebar groups, in order. */
export const DEV_SECTIONS: readonly DevSection[] = [
  {
    slug: 'introducao',
    label: 'Introdução',
    description: 'O que dá para integrar, a chave de API e a primeira chamada.',
  },
  {
    slug: 'fundamentos',
    label: 'Fundamentos',
    description:
      'Autenticação, formato de resposta, erros, limites de requisição e paginação.',
  },
  {
    slug: 'webhooks',
    label: 'Webhooks',
    description:
      'As URLs que o Steel recebe, como cada uma é verificada e o que o Steel envia.',
  },
  {
    slug: 'guias',
    label: 'Guias por caso de uso',
    description:
      'Exemplos completos: lead do seu site, chamado do seu sistema, workflow do CRM e eventos do GitHub/GitLab.',
  },
  {
    slug: 'mcp',
    label: 'Clientes de IA (MCP)',
    description:
      'Conecte Claude, ChatGPT, Cursor e outros clientes de IA ao workspace pelo servidor MCP do Steel.',
  },
  {
    slug: 'recursos',
    label: 'Recursos',
    description: 'Changelog da API e canais de suporte.',
  },
]

const LABELS = Object.fromEntries(
  DEV_SECTIONS.map((section) => [section.slug, section.label]),
) as Record<DevSectionSlug, string>

export function devSectionLabel(slug: DevSectionSlug): string {
  return LABELS[slug]
}

export function devSectionRank(slug: DevSectionSlug): number {
  return DEV_SECTIONS.findIndex((section) => section.slug === slug)
}
