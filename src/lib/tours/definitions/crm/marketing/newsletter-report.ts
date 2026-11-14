import type { TourDefinition } from '../../../types'

export const newsletterReportTour: TourDefinition = {
  key: 'crm.newsletters.report',
  version: 1,
  module: 'crm',
  title: 'Relatório da edição',
  description: 'Veja quem abriu, clicou e como foi o envio de uma edição.',
  route: '/crm/newsletters/:newsletterId/issues/:issueId/report',
  openFrom: '/crm/newsletters',
  docsHref: '/docs/crm/newsletter-edicoes',
  steps: [
    {
      title: 'Como a edição foi',
      body: 'Este relatório mostra o resultado de uma edição já enviada. Os números sobem aos poucos, conforme os assinantes abrem e clicam.',
    },
    {
      target: 'newsletter-report-funnel',
      title: 'Funil da edição',
      body: 'Acompanha o caminho do e-mail: enviados, entregues, abertos e clicados, sempre em relação ao que foi enviado.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-report-links',
      title: 'Cliques por link',
      body: 'Mostra quais links da edição foram clicados e quantas vezes. Serve para entender que assunto ou chamada interessou mais ao público.',
      placement: 'top',
    },
    {
      target: 'newsletter-report-recipients',
      title: 'Destinatários',
      body: 'Busque um assinante para ver se o e-mail chegou, se foi aberto ou clicado, e o motivo quando algum envio falhou.',
      placement: 'top',
    },
  ],
}
