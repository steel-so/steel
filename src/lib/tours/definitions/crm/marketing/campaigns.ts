import type { TourDefinition } from '../../../types'

export const campaignsTour: TourDefinition = {
  key: 'crm.campaigns',
  version: 1,
  module: 'crm',
  title: 'Campanhas',
  description: 'Crie campanhas de e-mail e WhatsApp e acompanhe cada uma.',
  route: '/crm/campaigns',
  docsHref: '/docs/crm/campanhas',
  steps: [
    {
      target: 'campaigns-header',
      title: 'Campanhas multicanal',
      body: 'Uma campanha leva um grupo de contatos de um e-mail, e do WhatsApp se você quiser, até um site ou formulário. Depois do envio, você vê quem abriu, clicou e converteu.',
      placement: 'bottom',
    },
    {
      target: 'campaigns-new',
      title: 'Nova campanha',
      body: 'Dê um nome à campanha e siga para o assistente. O nome vira o identificador usado nos links (utm_campaign), então escolha algo fácil de reconhecer nos relatórios.',
      placement: 'bottom',
    },
    {
      target: 'campaigns-grid',
      title: 'Suas campanhas',
      body: 'Cada cartão mostra a situação: rascunho, agendada, enviando ou concluída. Clique para continuar um rascunho ou ver os resultados de uma campanha já enviada.',
      placement: 'top',
    },
  ],
}
