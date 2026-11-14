import type { TourDefinition } from '../../types'

export const proceduresEditorTour: TourDefinition = {
  key: 'ai.procedures.editor',
  version: 1,
  module: 'ai',
  title: 'Editor de procedimento',
  description:
    'Montar um roteiro com passos obrigatórios e regras de transferência.',
  route: ['/ai/procedures/new', '/ai/procedures/:procedureId'],
  openFrom: '/ai/procedures',
  audience: 'admin',
  docsHref: '/docs/steel-ai/procedimentos',
  steps: [
    {
      target: 'procedure-when',
      title: 'Quando usar',
      body: 'Descreva em que situação o roteiro serve. A IA lê este texto para decidir se o pedido do cliente combina com este procedimento.',
      placement: 'bottom',
    },
    {
      target: 'procedure-steps',
      title: 'Passos na ordem',
      body: 'O sistema executa os passos na ordem, sem deixar a IA pular. Um passo pode pedir um dado ao cliente e guardá-lo numa variável para usar nos passos seguintes.',
      placement: 'top',
    },
    {
      target: 'procedure-add-step',
      title: 'Adicionar passo',
      body: 'Inclua mensagens, pedidos de dados, consultas e instruções para a IA. Em cada passo você pode marcar se ele é obrigatório e quando ele vale.',
      placement: 'top',
    },
    {
      target: 'procedure-attempts',
      title: 'Tentativas por dado',
      body: 'Define quantas vezes o cliente pode errar um dado pedido, como um CPF inválido. Passado o limite, um atendente assume a conversa.',
      placement: 'top',
    },
    {
      target: 'procedure-handoff',
      title: 'Mensagem de transferência',
      body: 'É o texto que o cliente recebe quando a conversa passa para uma pessoa. Escreva algo curto e cordial.',
      placement: 'top',
    },
  ],
}
