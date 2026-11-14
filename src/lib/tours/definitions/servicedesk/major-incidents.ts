import type { TourDefinition } from '../../types'

export const majorIncidentsTour: TourDefinition = {
  key: 'servicedesk.major-incidents',
  version: 1,
  module: 'servicedesk',
  title: 'Incidentes maiores',
  description: 'Os incidentes graves em andamento e o aviso aos clientes.',
  route: '/servicedesk/major-incidents',
  docsHref: '/docs/servicedesk/incidente-maior',
  steps: [
    {
      target: 'sd-major-title',
      title: 'Quando o problema é grande',
      body: 'Um incidente maior reúne vários chamados em torno de uma falha grave. Para declarar um, abra o chamado do incidente e use a aba Incidente maior.',
      placement: 'bottom',
    },
    {
      target: 'sd-major-actions',
      title: 'Filtro e páginas de status',
      body: 'O filtro alterna entre os incidentes ativos e os demais. O botão Páginas de status leva às páginas públicas onde os clientes acompanham a falha.',
      placement: 'bottom',
    },
    {
      target: 'sd-major-list',
      title: 'Cada incidente',
      body: 'O cartão mostra a situação, o impacto, o comandante, quantos chamados filhos e páginas de status estão ligados. Clique para abrir a sala do incidente.',
      placement: 'top',
    },
  ],
}
