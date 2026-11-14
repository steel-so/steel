import type { TourDefinition } from '../../../types'

export const emailCampaignsTour: TourDefinition = {
  key: 'crm.email-campaigns',
  version: 1,
  module: 'crm',
  title: 'Campanhas de e-mail',
  description: 'Envie um e-mail para uma lista, agende e acompanhe o envio.',
  route: '/crm/email-campaigns',
  docsHref: '/docs/crm/campanhas-de-email',
  steps: [
    {
      title: 'Envios de e-mail avulsos',
      body: 'Esta tela serve para disparar um e-mail rápido para contatos e listas. Para levar o público até um site ou formulário, com WhatsApp e resultados, use Campanhas.',
    },
    {
      target: 'email-campaigns-new',
      title: 'Nova campanha',
      body: 'Abre o painel de envio: remetente, assunto, conteúdo, destinatários e agendamento. Começando por um modelo, dá para enviar um teste só para você antes do envio de verdade.',
      placement: 'bottom',
    },
    {
      target: 'email-campaigns-table',
      title: 'Histórico de envios',
      body: 'Veja cada campanha com a situação, o número de destinatários e a data agendada. Clique numa linha para ver os detalhes e quem recebeu.',
      placement: 'top',
    },
    {
      title: 'Remetente e descadastro',
      body: 'O remetente vem dos domínios verificados da empresa; sem domínio verificado, vale o do Steel. Quem pediu para sair da lista (descadastro) nunca recebe, mesmo se estiver nos destinatários.',
    },
  ],
}
