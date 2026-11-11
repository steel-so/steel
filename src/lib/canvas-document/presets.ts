import type { CanvasFragment, CanvasNode } from '@/src/lib/canvas/types'
import { type DocumentOutlineSection, outlineToDocument } from './outline'

/**
 * Ready-made sections of the editor ("Seções prontas"), built from outline
 * sections with the same presets as the starters. Shaped like the shell's
 * `CanvasPresetItem` (pass `DOCUMENT_SECTION_PRESETS` as `presets`).
 */
export interface DocumentSectionPreset {
  id: string
  label: string
  category: string
  fragment: () => CanvasFragment
}

/** The section of a one-section outline as a fragment (ids are cloned by
 * the editor on insert). */
export function sectionFragment(
  section: DocumentOutlineSection,
): CanvasFragment {
  const { content } = outlineToDocument({
    title: section.name,
    kind: 'OTHER',
    sections: [section],
  })
  const root = content.nodes[content.rootId]
  const nodes: Record<string, CanvasNode> = {}
  for (const [id, node] of Object.entries(content.nodes)) {
    if (id !== content.rootId) nodes[id] = node
  }
  return { rootId: root.children?.[0] ?? '', nodes }
}

const SECTIONS: Array<{
  id: string
  label: string
  category: string
  section: DocumentOutlineSection
}> = [
  {
    id: 'cover',
    label: 'Capa',
    category: 'Abertura',
    section: {
      name: 'Capa',
      variant: 'cover',
      blocks: [
        { type: 'heading', text: 'Proposta para {{empresa.nome}}', level: 1 },
        {
          type: 'text',
          html: '<p>Preparada por {{responsavel.nome}} · {{workspace.nome}}</p>',
        },
        { type: 'validity' },
      ],
    },
  },
  {
    id: 'about',
    label: 'Sobre nós com números',
    category: 'Abertura',
    section: {
      name: 'Sobre nós',
      blocks: [
        { type: 'heading', text: 'Quem somos' },
        {
          type: 'text',
          html: '<p>Conte em poucas linhas a história da empresa e o que a torna a melhor escolha para este cliente.</p>',
        },
        {
          type: 'stats',
          items: [
            { value: '10+', label: 'anos de mercado' },
            { value: '350', label: 'clientes ativos' },
            { value: '98%', label: 'de satisfação' },
          ],
        },
      ],
    },
  },
  {
    id: 'scope',
    label: 'Escopo em duas colunas',
    category: 'Conteúdo',
    section: {
      name: 'Escopo',
      blocks: [
        { type: 'heading', text: 'Escopo' },
        {
          type: 'columns',
          columns: [
            [
              { type: 'heading', text: 'Incluído', level: 3 },
              {
                type: 'list',
                items: ['Primeiro item', 'Segundo item', 'Terceiro item'],
              },
            ],
            [
              { type: 'heading', text: 'Fora do escopo', level: 3 },
              {
                type: 'list',
                items: ['Primeiro item', 'Segundo item'],
              },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'timeline',
    label: 'Cronograma',
    category: 'Conteúdo',
    section: {
      name: 'Cronograma',
      blocks: [
        { type: 'heading', text: 'Cronograma' },
        {
          type: 'table',
          header: ['Etapa', 'Entrega', 'Prazo'],
          rows: [
            ['Início', 'Kickoff e acessos', 'Semana 1'],
            ['Execução', 'Configuração e testes', 'Semanas 2 e 3'],
            ['Entrega', 'Treinamento e virada', 'Semana 4'],
          ],
        },
      ],
    },
  },
  {
    id: 'testimonial',
    label: 'Depoimento',
    category: 'Conteúdo',
    section: {
      name: 'Depoimento',
      variant: 'highlight',
      blocks: [
        {
          type: 'quote',
          text: 'Uma frase de um cliente satisfeito que mostra o resultado do seu trabalho.',
          author: 'Nome do cliente, cargo e empresa',
        },
      ],
    },
  },
  {
    id: 'pricing',
    label: 'Investimento',
    category: 'Vendas',
    section: {
      name: 'Investimento',
      blocks: [
        { type: 'heading', text: 'Investimento' },
        {
          type: 'pricing',
          items: [
            {
              id: 'servico',
              name: 'Serviço principal',
              unitPrice: 5000,
              quantity: 1,
            },
            {
              id: 'mensalidade',
              name: 'Mensalidade',
              unitPrice: 600,
              quantity: 1,
              recurrence: 'monthly',
            },
            {
              id: 'extra',
              name: 'Item opcional',
              unitPrice: 900,
              quantity: 1,
              optional: true,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'accept',
    label: 'Aceite e contato',
    category: 'Vendas',
    section: {
      name: 'Aceite',
      blocks: [
        { type: 'heading', text: 'Próximos passos' },
        { type: 'accept', allowDecline: true },
        { type: 'contact-card' },
      ],
    },
  },
]

function toPreset(entry: (typeof SECTIONS)[number]): DocumentSectionPreset {
  const { section, ...meta } = entry
  return { ...meta, fragment: () => sectionFragment(section) }
}

export const DOCUMENT_SECTION_PRESETS = SECTIONS.map(toPreset)
