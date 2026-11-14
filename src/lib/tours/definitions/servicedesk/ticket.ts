import type { TourDefinition } from '../../types'

export const ticketTour: TourDefinition = {
  key: 'servicedesk.ticket',
  version: 1,
  module: 'servicedesk',
  title: 'Tela do chamado',
  description:
    'Fase, prazo, conversa, tarefas, aprovação, horas, custos e o copiloto de IA.',
  route: '/servicedesk/tickets/:number',
  openFrom: '/servicedesk/tickets',
  docsHref: '/docs/servicedesk/chamados',
  steps: [
    {
      title: 'Um chamado por inteiro',
      body: 'No topo ficam a situação e as ações. Abaixo, a descrição e as abas de trabalho. À direita, os detalhes do chamado.',
    },
    {
      target: 'sd-ticket-meta',
      title: 'Prioridade, SLA e risco',
      body: 'Mostra a prioridade, o tempo que falta para o SLA e, quando existe, o risco de o prazo estourar.',
      placement: 'bottom',
    },
    {
      target: 'sd-ticket-phase',
      title: 'Fase do chamado',
      body: 'Mude a fase conforme o atendimento avança. A porcentagem mostra quanto do fluxo já foi feito. Algumas fases pedem campos obrigatórios ou aprovação.',
      placement: 'bottom',
    },
    {
      target: 'sd-ticket-reply',
      title: 'Responder',
      body: 'Leva você ao campo de resposta da aba Conversa, onde ficam as mensagens e o histórico do atendimento.',
      placement: 'bottom',
    },
    {
      target: 'sd-ticket-tabs',
      title: 'Abas de trabalho',
      body: 'Conversa, Tarefas e Aprovação ficam à vista; em Aprovação você pede o aval de alguém por e-mail. Horas, Custos, Peças e Conhecimento estão no menu Mais.',
      placement: 'top',
    },
    {
      target: 'sd-ticket-sidebar',
      title: 'Detalhes e copiloto de IA',
      body: 'Aqui ficam responsável, prazos, cliente e campos. No fim, o Copiloto de IA resume o chamado e sugere resposta e solução. Abra a seção para usar.',
      placement: 'left',
    },
  ],
}
