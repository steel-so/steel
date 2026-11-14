import type { TourDefinition } from '../../types'

export const templatesTour: TourDefinition = {
  key: 'zap.templates',
  version: 1,
  module: 'zap',
  title: 'Templates do WhatsApp',
  description: 'Modelos de mensagem aprovados pela Meta.',
  route: '/zap/templates',
  docsHref: '/docs/comunicacao/templates',
  steps: [
    {
      target: 'zap-templates-intro',
      title: 'Para que servem os templates',
      body: 'São modelos de mensagem aprovados pela Meta. Você precisa deles para escrever a um cliente depois de 24 horas sem resposta e nas transmissões.',
      placement: 'bottom',
    },
    {
      target: 'zap-templates-actions',
      title: 'Criar e sincronizar',
      body: 'Escolha a conexão Meta e clique em "Sincronizar agora" para trazer os modelos da sua conta. Para fazer um novo, use o botão de criar template.',
      placement: 'bottom',
    },
    {
      target: 'zap-templates-table',
      title: 'Status e qualidade',
      body: 'A coluna Status mostra se a Meta aprovou, rejeitou ou ainda analisa. O ponto ao lado do nome indica a qualidade: modelos mal avaliados podem ser pausados.',
      placement: 'top',
    },
    {
      title: 'Botões e correções',
      body: 'Um modelo pode ter botões de resposta e, em "Ações dos botões", você define o que cada um faz. Se a Meta rejeitar, use "Corrigir e reenviar".',
    },
  ],
}
