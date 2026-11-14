import type { TourDefinition } from '../../types'

export const aiCampaignEditorTour: TourDefinition = {
  key: 'zap.ai-campaigns.editor',
  version: 1,
  module: 'zap',
  title: 'Montar uma campanha de IA',
  description: 'Os cinco passos para deixar a campanha pronta.',
  route: '/zap/campanhas-ia/:id/editar',
  openFrom: '/zap/campanhas-ia',
  docsHref: '/docs/comunicacao/campanhas-ia',
  steps: [
    {
      target: 'zap-ai-campaign-header',
      title: 'Sua campanha',
      body: 'Aqui você vê o nome e a situação da campanha. A seta leva de volta à lista de campanhas.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-campaign-steps',
      title: 'Cinco passos',
      body: 'Básico, Contatos, Mensagem, IA e Revisão. Quem já tem o que precisa ganha um visto, e você pode pular para qualquer passo.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-campaign-panel',
      title: 'Preencha o passo atual',
      body: 'Escolha quem recebe, o template e as instruções para a IA conversar e agir. Na Revisão você ajusta o ritmo de envio e inicia a campanha.',
      placement: 'top',
    },
  ],
}
