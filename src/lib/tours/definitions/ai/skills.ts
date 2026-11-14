import type { TourDefinition } from '../../types'

export const skillsTour: TourDefinition = {
  key: 'ai.skills',
  version: 1,
  module: 'ai',
  title: 'Skills do Steel AI',
  description: 'Instruções reutilizáveis que você chama com uma barra no chat.',
  route: '/ai/skills',
  docsHref: '/docs/steel-ai/skills',
  steps: [
    {
      target: 'skills-intro',
      title: 'Pedidos que você repete',
      body: 'Uma skill é uma instrução salva. No chat, digite / e o nome dela para usar. O Steel AI também escolhe uma skill sozinho quando o pedido combina.',
      placement: 'bottom',
    },
    {
      target: 'skills-new',
      title: 'Nova skill',
      body: 'Informe nome, comando, descrição e as instruções. Escolha o modo que o chat usa ao chamar a skill e se só você ou o workspace todo pode usá-la.',
      placement: 'bottom',
    },
    {
      title: 'Pessoais, do workspace e prontas',
      body: 'A lista separa as skills por tipo. Só administradores criam skills para o workspace todo. Em cada linha, Usar no chat abre uma conversa com o comando pronto.',
    },
  ],
}
