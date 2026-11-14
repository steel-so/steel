import type { TourDefinition } from '../../../types'

export const crmOpportunitiesTour: TourDefinition = {
  key: 'crm.opportunities',
  version: 1,
  module: 'crm',
  title: 'Oportunidades',
  description: 'Negócios em andamento, com valor, etapa e chance de fechar.',
  route: '/crm/opportunities',
  docsHref: '/docs/crm/oportunidades-e-funis',
  steps: [
    {
      title: 'Seus negócios em andamento',
      body: 'Cada oportunidade tem valor, etapa do funil, % de fechamento e data prevista. É aqui que você acompanha o que está perto de virar venda.',
    },
    {
      target: 'crm-table-search',
      title: 'Buscar oportunidades',
      body: 'Digite parte do nome para achar uma oportunidade. Se preferir, pergunte em português na barra acima, como "negócios acima de 10 mil".',
      placement: 'bottom',
    },
    {
      target: 'crm-table-filter',
      title: 'Filtrar por coluna',
      body: 'Filtre por etapa, responsável, empresa ou data de fechamento. Os filtros ficam salvos para você na próxima vez que voltar.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-columns',
      title: 'Escolher as colunas',
      body: 'Mostre ou esconda colunas como Valor, Funil, Etapa e % de fechamento, deixando só o que importa para o seu dia a dia.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-views',
      title: 'Tabela ou kanban',
      body: 'Troque para o kanban para ver as oportunidades em colunas por etapa. Arraste um card para outra coluna para mudar a etapa do negócio.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-new',
      title: 'Nova oportunidade',
      body: 'Cadastre um negócio informando nome, valor, funil e etapa. Você também pode vincular empresa, ponto de contato e responsável.',
      placement: 'bottom',
    },
    {
      title: 'Abra uma oportunidade',
      body: 'Clique em uma linha para ver a ficha: itens com quantidade, preço e desconto que somam o valor, proposta, documentos, saúde do negócio e linha do tempo.',
    },
  ],
}
