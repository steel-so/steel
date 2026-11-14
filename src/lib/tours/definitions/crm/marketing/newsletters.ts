import type { TourDefinition } from '../../../types'

export const newslettersTour: TourDefinition = {
  key: 'crm.newsletters',
  version: 1,
  module: 'crm',
  title: 'Newsletters',
  description: 'Publicações com assinantes próprios, enviadas do seu domínio.',
  route: '/crm/newsletters',
  docsHref: '/docs/crm/newsletters',
  steps: [
    {
      target: 'newsletters-header',
      title: 'Newsletters',
      body: 'Uma newsletter é uma publicação com assinantes próprios, enviada do domínio da empresa. Diferente de uma campanha, ela tem edições periódicas e quem se inscreve escolhe receber.',
      placement: 'bottom',
    },
    {
      target: 'newsletters-new',
      title: 'Nova newsletter',
      body: 'Crie a newsletter com nome e remetente. Depois reúna os assinantes por formulário, página pública ou importação, e escreva as edições.',
      placement: 'bottom',
    },
    {
      target: 'newsletters-grid',
      title: 'Suas newsletters',
      body: 'Cada cartão resume a newsletter. Clique para abrir as edições, os assinantes, a série de boas-vindas e as configurações.',
      placement: 'top',
    },
  ],
}
