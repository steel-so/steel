import type { TourDefinition } from '../../types'

export const memoryTour: TourDefinition = {
  key: 'ai.memory',
  version: 1,
  module: 'ai',
  title: 'Memória do Steel AI',
  description: 'O que o Steel AI lembra e como revisar, corrigir ou apagar.',
  route: '/ai/memory',
  docsHref: '/docs/steel-ai/memoria',
  steps: [
    {
      target: 'memory-search',
      title: 'Buscar na memória',
      body: 'O Steel AI guarda fatos úteis para as próximas conversas. Busque aqui por um assunto para revisar o que ele lembra.',
      placement: 'bottom',
    },
    {
      target: 'memory-workspace',
      title: 'Memória do workspace',
      body: 'Fatos que valem para todos, como o horário de atendimento. Todos veem, mas só administradores adicionam, editam e apagam.',
      placement: 'top',
    },
    {
      target: 'memory-personal',
      title: 'Memória pessoal',
      body: 'Preferências suas, vistas só por você e pelo Steel AI. Adicione um fato, edite ou apague quando algo estiver errado ou desatualizado.',
      placement: 'top',
    },
  ],
}
