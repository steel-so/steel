import type { TourDefinition } from '../../../types'

export const crmReportsTour: TourDefinition = {
  key: 'crm.reports',
  version: 1,
  module: 'crm',
  title: 'Relatórios',
  description: 'Monte tabelas de dados do CRM com colunas e agrupamentos.',
  route: '/crm/reports',
  docsHref: '/docs/crm/paineis-e-relatorios',
  steps: [
    {
      title: 'Relatórios do CRM',
      body: 'Um relatório é uma tabela de dados que você monta: escolhe a fonte, as colunas, os agrupamentos e as somas.',
    },
    {
      target: 'crm-table-search',
      title: 'Buscar relatórios',
      body: 'Digite o nome de um relatório para encontrá-lo. Clique em uma linha para abrir o construtor dele.',
      placement: 'bottom',
    },
    {
      target: 'crm-reports-new',
      title: 'Novo relatório',
      body: 'Dê um nome e escolha a fonte dos dados, ou comece por um relatório pronto. A fonte não muda depois; as colunas e os filtros você ajusta no construtor.',
      placement: 'bottom',
    },
  ],
}
