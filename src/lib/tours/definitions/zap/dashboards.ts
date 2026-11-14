import type { TourDefinition } from '../../types'

export const dashboardsTour: TourDefinition = {
  key: 'zap.dashboards',
  version: 1,
  module: 'zap',
  title: 'Painéis do WhatsApp',
  description: 'Painéis próprios sobre conversas, sentimento e transmissões.',
  route: '/zap/dashboards',
  steps: [
    {
      target: 'zap-dashboards-intro',
      title: 'Seus painéis',
      body: 'Um painel reúne gráficos sobre as conversas, o sentimento dos clientes e as transmissões, do jeito que a sua equipe precisa acompanhar.',
      placement: 'bottom',
    },
    {
      target: 'zap-dashboards-new',
      title: 'Criar um painel',
      body: 'Clique em "Novo painel", dê um título e depois adicione os gráficos que quiser dentro dele.',
      placement: 'bottom',
    },
    {
      target: 'zap-dashboards-list',
      title: 'Abrir ou remover',
      body: 'Clique no título para abrir o painel. A lixeira ao lado remove o painel e os gráficos dele, e isso não dá para desfazer.',
      placement: 'top',
    },
  ],
}
