import type { TourDefinition } from '../../types'

export const dashboardsTour: TourDefinition = {
  key: 'servicedesk.dashboards',
  version: 1,
  module: 'servicedesk',
  title: 'Painéis',
  description:
    'Indicadores de SLA, backlog e satisfação, inclusive no modo TV.',
  route: '/servicedesk/dashboards',
  docsHref: '/docs/servicedesk/paineis-e-relatorios',
  steps: [
    {
      target: 'sd-dashboards-title',
      title: 'Indicadores do atendimento',
      body: 'Os painéis reúnem SLA, backlog, tempo de resolução, satisfação e custos do ServiceDesk num só lugar.',
      placement: 'bottom',
    },
    {
      target: 'sd-dashboards-new',
      title: 'Novo painel',
      body: 'Crie um painel com o nome que a equipe reconheça e monte os widgets a partir das fontes do ServiceDesk.',
      placement: 'bottom',
    },
    {
      target: 'sd-dashboards-grid',
      title: 'Seus painéis',
      body: 'Clique num painel para abrir. O botão Modo TV de cada cartão exibe o painel em tela cheia, ideal para o telão. O menu do cartão duplica, renomeia ou exclui.',
      placement: 'top',
    },
  ],
}
