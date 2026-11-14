import type { TourDefinition } from '../../types'

export const aiCampaignsTour: TourDefinition = {
  key: 'zap.ai-campaigns',
  version: 1,
  module: 'zap',
  title: 'Campanhas de IA',
  description: 'A IA envia a mensagem e conversa com quem responder.',
  route: '/zap/campanhas-ia',
  docsHref: '/docs/comunicacao/campanhas-ia',
  steps: [
    {
      target: 'zap-ai-campaigns-intro',
      title: 'Campanha que conversa',
      body: 'A IA envia um template a um grupo de contatos, conversa com quem responder e executa as ações que você definir.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-campaigns-new',
      title: 'Criar uma campanha',
      body: 'Dê um nome e siga os passos: contatos, mensagem, instruções da IA e revisão. O que você preenche fica salvo como rascunho.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-campaigns-filters',
      title: 'Filtrar por situação',
      body: 'Veja só as campanhas em rascunho, em andamento, pausadas ou concluídas. A busca ao lado procura pelo nome.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-campaigns-table',
      title: 'Andamento e resultado',
      body: 'Cada linha mostra o progresso, quantas pessoas responderam e quantas deram certo. Use "Iniciar" e "Pausar" para controlar o envio.',
      placement: 'top',
    },
  ],
}
