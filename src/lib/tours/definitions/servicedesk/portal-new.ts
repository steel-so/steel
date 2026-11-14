import type { TourDefinition } from '../../types'

export const portalNewTour: TourDefinition = {
  key: 'servicedesk.portal.new',
  version: 1,
  module: 'servicedesk',
  title: 'Abrir um chamado',
  description:
    'Como preencher o pedido para a equipe de TI resolver mais rápido.',
  route: '/servicedesk/portal/new',
  docsHref: '/docs/servicedesk/portal-do-solicitante',
  steps: [
    {
      title: 'Conte o que você precisa',
      body: 'O formulário é curto. Quanto mais detalhes você der, mais rápido a equipe resolve.',
    },
    {
      target: 'sd-portal-new-type',
      title: 'Do que você precisa?',
      body: 'Escolha o tipo de pedido, por exemplo um problema que está acontecendo ou uma solicitação. Se tiver dúvida, escolha o que mais se parece.',
      placement: 'right',
    },
    {
      target: 'sd-portal-new-title',
      title: 'Resumo',
      body: 'Diga em poucas palavras o que está acontecendo. Enquanto você escreve, o portal pode sugerir artigos que já resolvem o seu caso.',
      placement: 'bottom',
    },
    {
      target: 'sd-portal-new-submit',
      title: 'Enviar chamado',
      body: 'Em Detalhes, conte o que você já tentou. Escolha o assunto e a urgência, se aparecerem, e envie. A equipe é avisada na hora.',
      placement: 'top',
    },
  ],
}
