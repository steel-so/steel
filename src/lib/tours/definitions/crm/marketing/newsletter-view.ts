import type { TourDefinition } from '../../../types'

export const newsletterViewTour: TourDefinition = {
  key: 'crm.newsletters.view',
  version: 1,
  module: 'crm',
  title: 'Gerenciar uma newsletter',
  description: 'Edições, assinantes, segmentos e a série de boas-vindas.',
  route: '/crm/newsletters/:newsletterId',
  openFrom: '/crm/newsletters',
  docsHref: '/docs/crm/newsletter-no-crm',
  steps: [
    {
      target: 'newsletter-sender',
      title: 'Remetente verificado',
      body: 'Só é possível enviar uma edição quando o domínio do remetente está verificado. Se aparecer o aviso, clique nele para ir verificar o domínio.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-segments',
      title: 'Segmentos',
      body: 'Salve públicos por origem, engajamento ou dados da pessoa no CRM, como cargo e cidade, e escolha um deles na hora de enviar. Assim cada edição vai só para quem interessa.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-tabs',
      title: 'As áreas da newsletter',
      body: 'Edições para escrever e enviar. Assinantes para ver e importar quem recebe. Boas-vindas, Configurações e Resumo completam o conjunto.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-new-issue',
      title: 'Nova edição',
      body: 'Cria uma edição e abre o editor. A lista abaixo mostra cada edição com a situação, a data de envio e as taxas de abertura e de clique.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-welcome-tab',
      title: 'Série de boas-vindas',
      body: 'E-mails automáticos para cada novo assinante, contados a partir da confirmação da inscrição. Quem foi importado não recebe a série.',
      placement: 'bottom',
    },
  ],
}
