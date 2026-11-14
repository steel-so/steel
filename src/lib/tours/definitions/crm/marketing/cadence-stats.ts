import type { TourDefinition } from '../../../types'

export const cadenceStatsTour: TourDefinition = {
  key: 'crm.cadences.stats',
  version: 1,
  module: 'crm',
  title: 'Estatísticas da cadência',
  description: 'Veja quantos leads estão em cada passo e quem respondeu.',
  route: '/crm/cadences/:cadenceId',
  openFrom: '/crm/cadences',
  docsHref: '/docs/crm/cadencias-de-vendas',
  steps: [
    {
      target: 'cadence-stats-tiles',
      title: 'Visão geral',
      body: 'Quantos leads foram inscritos, quantos seguem em andamento, pausados, responderam, concluíram ou foram encerrados.',
      placement: 'bottom',
    },
    {
      target: 'cadence-stats-funnel',
      title: 'Funil por passo',
      body: 'Mostra quantos inscritos chegaram a cada passo e o que aconteceu ali: executados, pulados e falhas. Aberturas e cliques de e-mail são estimativas.',
      placement: 'top',
    },
    {
      target: 'cadence-stats-enrollments',
      title: 'Inscritos',
      body: 'A lista de leads dentro da cadência, com a situação de cada um. Use para acompanhar quem está ativo e quem já parou.',
      placement: 'top',
    },
  ],
}
