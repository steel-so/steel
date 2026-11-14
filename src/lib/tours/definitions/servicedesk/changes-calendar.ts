import type { TourDefinition } from '../../types'

export const changesCalendarTour: TourDefinition = {
  key: 'servicedesk.changes.calendar',
  version: 1,
  module: 'servicedesk',
  title: 'Calendário de mudanças',
  description: 'Mudanças agendadas, janelas de manutenção e congelamentos.',
  route: '/servicedesk/changes/calendar',
  docsHref: '/docs/servicedesk/aprovacoes-e-mudancas',
  steps: [
    {
      target: 'sd-change-views',
      title: 'Quadro ou calendário',
      body: 'As mudanças podem ser vistas no quadro, por fase, ou aqui no calendário, por data. O calendário ajuda a evitar duas mudanças ao mesmo tempo.',
      placement: 'bottom',
    },
    {
      target: 'sd-change-period',
      title: 'Navegue pelo tempo',
      body: 'Use as setas para ir ao período anterior ou ao próximo. O botão Hoje volta para a data de hoje.',
      placement: 'bottom',
    },
    {
      target: 'sd-change-mode',
      title: 'Mês ou semana',
      body: 'Veja o mês inteiro para planejar com folga ou só uma semana para olhar cada dia mais de perto.',
      placement: 'bottom',
    },
    {
      target: 'sd-change-grid',
      title: 'Os dias',
      body: 'Cada dia lista as mudanças agendadas e destaca as janelas de manutenção e de congelamento. Mudanças em conflito ou dentro de um congelamento aparecem em destaque.',
      placement: 'top',
    },
    {
      target: 'sd-change-day',
      title: 'O dia escolhido',
      body: 'Clique num dia e veja aqui as janelas e as mudanças dele. Clique numa mudança para abrir o chamado. As janelas são criadas em Configurações, na seção Mudanças.',
      placement: 'left',
    },
  ],
}
