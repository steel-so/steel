import type { TourDefinition } from '../../types'

export const agentsNewTour: TourDefinition = {
  key: 'ai.agents.new',
  version: 1,
  module: 'ai',
  title: 'Criar um agente',
  description: 'Instruções, gatilho, ferramentas e teste antes de ativar.',
  route: '/ai/agents/new',
  audience: 'admin',
  docsHref: '/docs/steel-ai/agentes',
  steps: [
    {
      title: 'Um agente que trabalha sozinho',
      body: 'Um agente é uma rotina do Steel AI que roda em segundo plano, com instruções próprias e as permissões de um responsável.',
    },
    {
      target: 'agent-instructions',
      title: 'Instruções',
      body: 'Escreva o que o agente deve fazer, com quais critérios e o que nunca deve fazer. Quanto mais específico, melhor, porque ele roda sem ajuda.',
      placement: 'top',
    },
    {
      target: 'agent-trigger',
      title: 'Gatilho',
      body: 'Manual roda quando você mandar. Agenda roda em horários fixos. Evento roda quando algo acontece, como um chamado aberto ou um lead criado.',
      placement: 'top',
    },
    {
      target: 'agent-tools',
      title: 'Ferramentas permitidas',
      body: 'Leituras rodam sempre. Escritas ficam como Requer aprovação, que é o padrão, ou Automática. Exclusões sempre pedem a sua aprovação.',
      placement: 'top',
    },
    {
      target: 'agent-enabled',
      title: 'Começa pausado',
      body: 'Deixe o agente Pausado até testar. Depois de criar, use Testar agente para ver o que ele faria, sem alterar nada, e só então ative.',
      placement: 'top',
    },
    {
      target: 'agent-save',
      title: 'Criar agente',
      body: 'Ao criar, você vai para a página do agente, onde acompanha as execuções, as versões e faz as simulações.',
      placement: 'top',
    },
  ],
}
