import type { TourDefinition } from '../../types'

export const conversationsTour: TourDefinition = {
  key: 'zap.conversations',
  version: 1,
  module: 'zap',
  title: 'Conversas do WhatsApp',
  description: 'Como achar, assumir, responder e fechar uma conversa.',
  route: '/zap',
  docsHref: '/docs/comunicacao/conversas',
  steps: [
    {
      title: 'Seu atendimento por aqui',
      body: 'Esta tela reúne as conversas de WhatsApp da sua equipe. A lista fica à esquerda e a conversa aberta, à direita.',
    },
    {
      target: 'zap-conversations-search',
      title: 'Buscar conversa',
      body: 'Digite o nome ou o número do contato para achar uma conversa na hora. O botão ao lado inicia uma conversa nova.',
      placement: 'right',
    },
    {
      target: 'zap-conversations-tabs',
      title: 'Ativas, fechadas e arquivadas',
      body: 'As conversas em andamento ficam em "Ativas". Ao terminar um atendimento, ele vai para "Fechadas". "Arquivadas" guarda o que você tirou da frente.',
      placement: 'right',
    },
    {
      target: 'zap-conversations-filters',
      title: 'Fila e minhas conversas',
      body: 'Use "Minhas" para ver só o que é seu e "Fila" para as conversas que ninguém assumiu ainda. Também dá para filtrar por equipe e por prazo de resposta.',
      placement: 'right',
    },
    {
      target: 'zap-conversations-list',
      title: 'Lista de conversas',
      body: 'Um clique abre a conversa. O número em destaque mostra quantas mensagens você ainda não leu. No menu de três pontos você fixa ou arquiva.',
      placement: 'right',
    },
    {
      target: 'zap-conversation-transfer',
      title: 'Passar para outra pessoa',
      body: 'Em "Transferir conversa" você escolhe quem vai atender. Para devolver sem escolher ninguém, use "Devolver para a fila".',
      placement: 'bottom',
    },
    {
      target: 'zap-conversation-composer',
      title: 'Responder e janela de 24 horas',
      body: 'Digite "/" para usar uma mensagem rápida. Na API da Meta, 24 horas depois da última mensagem do cliente só dá para enviar um modelo aprovado.',
      placement: 'top',
    },
    {
      target: 'zap-conversation-close',
      title: 'Fechar a conversa',
      body: 'Quando o atendimento terminar, clique em "Fechar" e registre como ele acabou. Se o cliente escrever de novo, você pode reabrir.',
      placement: 'bottom',
    },
  ],
}
