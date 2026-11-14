import type { TourDefinition } from '../../types'

export const majorIncidentRoomTour: TourDefinition = {
  key: 'servicedesk.major-incidents.room',
  version: 1,
  module: 'servicedesk',
  title: 'Sala do incidente',
  description:
    'Atualizações, chamados filhos e páginas de status de um incidente.',
  route: '/servicedesk/major-incidents/:incidentId',
  openFrom: '/servicedesk/major-incidents',
  docsHref: '/docs/servicedesk/incidente-maior',
  steps: [
    {
      target: 'sd-incident-header',
      title: 'Resumo do incidente',
      body: 'Situação, impacto, comandante e chamado principal. A Sala de guerra chama especialistas para ajudar, e Resolver encerra o incidente.',
      placement: 'bottom',
    },
    {
      target: 'sd-incident-update',
      title: 'Nova atualização',
      body: 'Informe a situação e escreva o que o cliente precisa saber agora. Se houver página de status, dá para publicar nela e avisar os assinantes.',
      placement: 'right',
    },
    {
      target: 'sd-incident-timeline',
      title: 'Linha do tempo',
      body: 'Todas as atualizações em ordem, marcadas como públicas ou internas, com o autor e quantos assinantes foram avisados.',
      placement: 'top',
    },
    {
      target: 'sd-incident-pages',
      title: 'Páginas de status',
      body: 'As páginas públicas em que este incidente aparece. Use Editar para escolher outras enquanto o incidente estiver ativo.',
      placement: 'left',
    },
    {
      target: 'sd-incident-children',
      title: 'Chamados filhos',
      body: 'Os chamados de clientes afetados pela mesma falha. Use Vincular para juntar mais um e resolver todos de uma vez ao encerrar.',
      placement: 'left',
    },
  ],
}
