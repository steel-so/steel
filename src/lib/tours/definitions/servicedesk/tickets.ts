import type { TourDefinition } from '../../types'

export const ticketsTour: TourDefinition = {
  key: 'servicedesk.tickets',
  version: 1,
  module: 'servicedesk',
  title: 'Fila de chamados',
  description:
    'Kanban, lista ou tabela, com filtros, prioridade, SLA, risco e abertura de chamado.',
  route: [
    '/servicedesk/tickets',
    '/servicedesk/incidents',
    '/servicedesk/requests',
    '/servicedesk/changes',
    '/servicedesk/problems',
  ],
  docsHref: '/docs/servicedesk/chamados',
  steps: [
    {
      title: 'A fila da equipe',
      body: 'Aqui ficam os chamados do atendimento. Veja como achar o que importa, mudar a forma de ver a fila e abrir um chamado novo.',
    },
    {
      target: 'sd-board-search',
      title: 'Busca',
      body: 'Digite parte do título, da descrição ou do código do chamado. A tecla / leva o cursor direto para este campo.',
      placement: 'bottom',
    },
    {
      target: 'sd-board-filter',
      title: 'Filtros',
      body: 'Filtre por prioridade, responsável, cliente, SLA, risco e mais. Em Atalhos há opções prontas, como Meus chamados, SLA violado e Risco alto.',
      placement: 'bottom',
    },
    {
      target: 'sd-board-modes',
      title: 'Kanban, lista ou tabela',
      body: 'Troque a forma de ver a fila. O Kanban tem uma coluna por fase e deixa mover o cartão; a Lista agrupa os chamados; a Tabela deixa escolher as colunas.',
      placement: 'bottom',
    },
    {
      target: 'sd-board-views',
      title: 'Visões salvas',
      body: 'Guarde a combinação de filtros, ordem e colunas que você usa sempre e volte a ela com um clique.',
      placement: 'bottom',
    },
    {
      target: 'sd-board-types',
      title: 'Tipos de chamado',
      body: 'Alterne entre Todos, Incidentes, Requisições, Mudanças e Problemas. Cada cartão traz a prioridade, o prazo do SLA e o risco previsto do chamado.',
      placement: 'bottom',
    },
    {
      target: 'sd-board-new',
      title: 'Novo chamado',
      body: 'Abre o formulário com tipo, modelo pronto, título, descrição, catálogo, impacto e urgência, que definem a prioridade. A tecla N também abre.',
      placement: 'bottom',
    },
  ],
}
