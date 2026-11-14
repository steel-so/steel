import type { TourDefinition } from '../../../types'

export const workflowEditorTour: TourDefinition = {
  key: 'crm.workflows.editor',
  version: 1,
  module: 'crm',
  title: 'Editor de workflow',
  description: 'Monte o fluxo com gatilho, condições e ações, teste e ative.',
  route: '/crm/workflows/:id',
  openFrom: '/crm/workflows',
  docsHref: '/docs/crm/workflows',
  desktopOnly: true,
  mobileSummary:
    'O editor de workflows é um quadro visual e precisa de uma tela maior. Abra esta página em um computador ou tablet para montar o fluxo, testar e ativar.',
  steps: [
    {
      title: 'Gatilho, condições e ações',
      body: 'Todo workflow começa com um gatilho, o que faz o fluxo começar. Depois vêm as etapas: condições, esperas e ações. Você monta tudo no quadro e só vale depois de Ativar.',
    },
    {
      target: 'workflow-add',
      title: 'Adicionar etapa',
      body: 'Primeiro escolha o gatilho. Depois acrescente etapas: Se / senão e Filtro para condições, Atraso para esperar, e ações como Criar registro, Enviar e-mail e Enviar WhatsApp.',
      placement: 'bottom',
    },
    {
      target: 'workflow-canvas',
      title: 'O quadro do fluxo',
      body: 'Arraste as etapas para organizá-las e ligue uma à outra. Clique numa etapa para configurá-la no painel que abre à direita.',
      placement: 'top',
    },
    {
      target: 'workflow-test',
      title: 'Testar',
      body: 'Roda o fluxo uma vez com dados de teste, sem esperar o gatilho acontecer de verdade. O resultado aparece na lista de execuções.',
      placement: 'bottom',
    },
    {
      target: 'workflow-runs',
      title: 'Ver execuções',
      body: 'Mostra cada vez que o fluxo rodou, etapa por etapa, e onde algo falhou. É o primeiro lugar a olhar quando uma automação não fez o esperado.',
      placement: 'bottom',
    },
    {
      target: 'workflow-activate',
      title: 'Ativar',
      body: 'Coloca as mudanças no ar. Enquanto você edita, o workflow fica como rascunho. Descartar volta para a última versão que estava ativa.',
      placement: 'bottom',
    },
  ],
}
