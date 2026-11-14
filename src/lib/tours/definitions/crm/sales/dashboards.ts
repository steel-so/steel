import type { TourDefinition } from '../../../types'

export const crmDashboardsTour: TourDefinition = {
  key: 'crm.dashboards',
  version: 1,
  module: 'crm',
  title: 'Painéis',
  description: 'Crie painéis com gráficos e números do CRM e do WhatsApp.',
  route: '/crm/dashboards',
  docsHref: '/docs/crm/paineis-e-relatorios',
  steps: [
    {
      title: 'Painéis do CRM',
      body: 'Um painel reúne gráficos, tabelas e números que você quer acompanhar de relance. Cada equipe pode ter os seus.',
    },
    {
      target: 'crm-dashboard-tv-template',
      title: 'Painel pronto para a TV',
      body: 'Clique em "Criar Vendas — TV" para gerar de uma vez um painel com meta do mês, ranking e placar do dia, pronto para a sala de vendas.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-search',
      title: 'Buscar painéis',
      body: 'Digite o nome para achar um painel. Clique no nome dele na tabela para abrir.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-new',
      title: 'Criar um painel',
      body: 'Clique em "Novo painel" e dê um nome. Depois abra o painel para montar os widgets, que são os blocos de gráficos e números.',
      placement: 'bottom',
    },
  ],
}
