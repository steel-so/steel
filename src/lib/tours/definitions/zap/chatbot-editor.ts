import type { TourDefinition } from '../../types'

export const chatbotEditorTour: TourDefinition = {
  key: 'zap.chatbots.editor',
  version: 1,
  module: 'zap',
  title: 'Editor de chatbot',
  description: 'Monte o fluxo de atendimento automático em blocos.',
  route: '/zap/chatbots/:id',
  openFrom: '/zap/chatbots',
  desktopOnly: true,
  mobileSummary:
    'O editor de chatbot é um quadro de blocos pensado para telas grandes. Abra esta página no computador para montar, testar e publicar o fluxo.',
  docsHref: '/docs/comunicacao/chatbots',
  steps: [
    {
      title: 'Atendimento em blocos',
      body: 'O chatbot conversa com o contato seguindo o caminho que você desenhar: mensagens, perguntas, condições e, quando precisar, a passagem para uma pessoa.',
    },
    {
      target: 'zap-chatbot-canvas',
      title: 'O quadro do fluxo',
      body: 'Cada bloco é um passo da conversa. Arraste para organizar, ligue um bloco ao outro pelas bolinhas e clique num bloco para editar o conteúdo.',
      placement: 'top',
    },
    {
      target: 'zap-chatbot-add-block',
      title: 'Adicionar bloco',
      body: 'Escolha mensagem, menu de opções, pergunta, condição, criar lead, abrir chamado ou "Passar para atendente" para entregar a conversa a uma equipe.',
      placement: 'bottom',
    },
    {
      target: 'zap-chatbot-trigger',
      title: 'Quando o chatbot começa',
      body: 'Em "Gatilho" você define o início: nova conversa, uma palavra-chave ou mensagem fora do horário de atendimento.',
      placement: 'bottom',
    },
    {
      target: 'zap-chatbot-test',
      title: 'Teste antes de publicar',
      body: 'Em "Testar" você conversa com o chatbot como se fosse o contato, sem enviar nada a ninguém.',
      placement: 'bottom',
    },
    {
      target: 'zap-chatbot-verify',
      title: 'Verificar o fluxo',
      body: 'A verificação aponta blocos soltos ou incompletos. Erros impedem a publicação, e avisos são só recomendações.',
      placement: 'bottom',
    },
    {
      target: 'zap-chatbot-publish',
      title: 'Publicar',
      body: 'O rascunho é salvo sozinho, mas só vale para os clientes depois de "Publicar". Com ele publicado, você pode pausar e ativar quando quiser.',
      placement: 'bottom',
    },
  ],
}
