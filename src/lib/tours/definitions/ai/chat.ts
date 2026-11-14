import type { TourDefinition } from '../../types'

export const chatTour: TourDefinition = {
  key: 'ai.chat',
  version: 1,
  module: 'ai',
  title: 'Conversar com o Steel AI',
  description: 'Modos, skills com barra, confirmação de ações e anexos.',
  route: '/ai',
  docsHref: '/docs/steel-ai/modos',
  steps: [
    {
      target: 'ai-composer',
      title: 'Pergunte ou peça uma tarefa',
      body: 'Escreva o que precisa. Digite / no início da mensagem para abrir a lista de skills, pedidos prontos que você chama pelo nome, como /my-work.',
      placement: 'top',
    },
    {
      target: 'ai-modes',
      title: 'Modo da conversa',
      body: 'Ask só responde e consulta. Build propõe ações e espera a sua confirmação. Autopilot executa sozinho, se um administrador liberar. Teste só simula.',
      placement: 'top',
    },
    {
      title: 'Você confirma antes de mudar',
      body: 'No modo Build, o Steel AI mostra uma prévia do que vai alterar. Nada acontece até você clicar em Confirmar, e exclusões pedem uma segunda confirmação.',
    },
    {
      target: 'ai-attach',
      title: 'Anexos',
      body: 'Anexe arquivos ou fotos para o Steel AI ler junto com a sua pergunta. Também dá para colar uma imagem ou arrastar o arquivo para a mensagem.',
      placement: 'top',
    },
  ],
}
