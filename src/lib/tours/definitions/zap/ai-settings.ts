import type { TourDefinition } from '../../types'

export const aiSettingsTour: TourDefinition = {
  key: 'zap.ai-settings',
  version: 1,
  module: 'zap',
  title: 'IA no atendimento',
  description: 'Resposta automática, copiloto e base de conhecimento.',
  route: '/zap/configuracoes/ai',
  audience: 'admin',
  docsHref: '/docs/comunicacao/ia-e-atendimento',
  steps: [
    {
      target: 'zap-ai-active',
      title: 'Ligar a resposta automática',
      body: 'Com "IA ativa", a IA responde as conversas novas até que um atendente assuma. O provedor e a cota mensal ficam nos ajustes do workspace.',
      placement: 'bottom',
    },
    {
      target: 'zap-ai-prompt',
      title: 'Instruções da IA',
      body: 'Explique como a IA deve falar e o que pode responder: tom, dados da empresa e o que fazer quando não souber. Instruções claras dão respostas melhores.',
      placement: 'top',
    },
    {
      target: 'zap-ai-copilot',
      title: 'Copiloto do atendente',
      body: 'Ao transferir uma conversa, o Steel AI escreve um resumo e os pendentes na linha do tempo, só para a equipe. O contato não recebe nada.',
      placement: 'top',
    },
    {
      target: 'zap-ai-knowledge',
      title: 'Base de conhecimento',
      body: 'Envie PDF, DOCX, TXT ou CSV com informações da empresa. A IA usa o conteúdo como referência. PDFs só de imagem não são lidos.',
      placement: 'top',
    },
  ],
}
