import type { TourDefinition } from '../../../types'

export const crmDashboardBuilderTour: TourDefinition = {
  key: 'crm.dashboards.builder',
  version: 1,
  module: 'crm',
  title: 'Montar um painel',
  description: 'Adicione widgets, ajuste o layout e use o modo TV.',
  route: '/crm/dashboards/:id',
  openFrom: '/crm/dashboards',
  docsHref: '/docs/crm/paineis-e-relatorios',
  steps: [
    {
      title: 'Monte o seu painel',
      body: 'Cada bloco do painel é um widget. Você escolhe o que mostrar, onde ele fica e quão grande ele é.',
    },
    {
      target: 'crm-dashboard-add',
      title: 'Adicionar widget',
      body: 'Em "Adicionar widget" você escolhe o tipo (gráfico, tabela, texto ou página incorporada), a fonte dos dados, como leads ou oportunidades, e o período.',
      placement: 'bottom',
    },
    {
      target: 'crm-dashboard-layout',
      title: 'Editar layout',
      body: 'Clique em "Editar layout" para arrastar e redimensionar os widgets. Nesse modo também aparecem os botões de editar e remover cada um. Clique em "Concluir" ao terminar.',
      placement: 'bottom',
    },
    {
      target: 'crm-dashboard-screens',
      title: 'Telas do painel',
      body: 'Divida o painel em várias telas para não encher uma só. A engrenagem permite renomear a tela e definir a rotação no modo TV.',
      placement: 'bottom',
    },
    {
      target: 'crm-dashboard-tv',
      title: 'Modo TV',
      body: 'Abre o painel em tela cheia, com as telas alternando sozinhas, ideal para deixar rodando na TV da equipe.',
      placement: 'bottom',
    },
    {
      target: 'crm-dashboard-tv-link',
      title: 'Link da TV',
      body: 'Gere um link para abrir o painel em uma TV sem fazer login. A tela é só leitura e o acesso para quando você revoga o link.',
      placement: 'bottom',
    },
  ],
}
