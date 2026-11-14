import type { TourDefinition } from '../../types'

export const inboxTour: TourDefinition = {
  key: 'platform.inbox',
  version: 1,
  module: 'platform',
  title: 'Caixa de entrada',
  description: 'Como ler, filtrar e organizar os avisos de todos os módulos.',
  route: '/inbox',
  docsHref: '/docs/workspace/caixa-de-entrada',
  steps: [
    {
      title: 'Seus avisos num só lugar',
      body: 'A caixa de entrada reúne os avisos do ServiceDesk, do CRM, da Comunicação e do Steel AI, como num programa de e-mail.',
    },
    {
      target: 'inbox-folders',
      title: 'Pastas',
      body: 'Alterne entre Tudo, Não lidas, Adiadas e Arquivadas. Ao lado, use a busca e os filtros de módulo e de tipo para achar um aviso específico.',
      placement: 'bottom',
    },
    {
      target: 'inbox-quick-filters',
      title: 'Filtros rápidos',
      body: 'Veja só as Menções, o que foi Atribuído a você ou apenas as Não lidas, com um clique. Clique de novo no filtro para desligá-lo.',
      placement: 'bottom',
    },
    {
      target: 'inbox-ai-pending',
      title: 'Pendências da IA',
      body: 'Ações que o Steel AI propôs e esperam a sua decisão ficam aqui. Confira a prévia de cada uma e aprove ou rejeite sem sair da caixa.',
      placement: 'bottom',
    },
    {
      target: 'inbox-list',
      title: 'Lista e leitura',
      body: 'Clique em um aviso para ler os detalhes ao lado. Ao abrir, ele é marcado como lido. Você também pode arquivar, adiar ou excluir cada aviso.',
      placement: 'right',
    },
    {
      target: 'inbox-more',
      title: 'Limpar de uma vez',
      body: 'Neste menu você marca todas como lidas, arquiva as já lidas e ajusta as preferências de notificação. A maioria das ações tem a opção Desfazer.',
      placement: 'bottom',
    },
  ],
}
