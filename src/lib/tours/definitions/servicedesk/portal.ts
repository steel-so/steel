import type { TourDefinition } from '../../types'

export const portalTour: TourDefinition = {
  key: 'servicedesk.portal',
  version: 1,
  module: 'servicedesk',
  title: 'Portal do solicitante',
  description: 'Como pedir ajuda à equipe de TI e acompanhar seus pedidos.',
  route: '/servicedesk/portal',
  docsHref: '/docs/servicedesk/portal-do-solicitante',
  steps: [
    {
      target: 'sd-portal-welcome',
      title: 'Seu portal de atendimento',
      body: 'Aqui você pede ajuda à equipe de TI e acompanha cada pedido, sem precisar de e-mail ou telefone.',
      placement: 'bottom',
    },
    {
      target: 'sd-portal-new',
      title: 'Abrir chamado',
      body: 'Clique aqui sempre que precisar de ajuda. Você conta o que está acontecendo e recebe o número do pedido.',
      placement: 'bottom',
    },
    {
      target: 'sd-portal-tickets',
      title: 'Meus chamados',
      body: 'Seus pedidos aparecem aqui, com uma barra que mostra o quanto já andaram. Clique em um deles para ver a conversa com a equipe e responder.',
      placement: 'top',
    },
    {
      target: 'sd-portal-help',
      title: 'Resolva sozinho',
      body: 'Antes de abrir um chamado, procure aqui. A resposta pode já estar num passo a passo escrito pela equipe de TI.',
      placement: 'top',
    },
  ],
}
