import type { TourDefinition } from '../../types'

export const teamsTour: TourDefinition = {
  key: 'zap.teams',
  version: 1,
  module: 'zap',
  title: 'Equipes de atendimento',
  description: 'Quem atende o quê e quem enxerga cada conversa.',
  route: '/zap/equipes',
  steps: [
    {
      target: 'zap-teams-intro',
      title: 'Para que servem as equipes',
      body: 'Cada pessoa vê as conversas atribuídas a ela e a fila da sua equipe. Líderes também acompanham as conversas dos agentes da equipe.',
      placement: 'bottom',
    },
    {
      target: 'zap-teams-new',
      title: 'Criar uma equipe',
      body: 'Clique em "Nova equipe", dê um nome e escolha quem são os líderes e os agentes. Só administradores criam e editam equipes.',
      placement: 'bottom',
    },
    {
      target: 'zap-teams-list',
      title: 'Líderes e agentes',
      body: 'Cada cartão mostra a equipe e seus membros. O ponto ao lado do nome indica quem está disponível ou ausente. Use "Editar" para mudar a composição.',
      placement: 'top',
    },
    {
      title: 'Quem vê o quê',
      body: 'Quem não é dono nem administrador vê só as próprias conversas e a fila da equipe. Dono e administradores sem equipe enxergam tudo.',
    },
  ],
}
