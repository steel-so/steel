import type { TourDefinition } from '../../../types'

export const workflowsTour: TourDefinition = {
  key: 'crm.workflows',
  version: 1,
  module: 'crm',
  title: 'Workflows',
  description: 'Automatize tarefas do CRM: algo acontece e o Steel reage.',
  route: '/crm/workflows',
  docsHref: '/docs/crm/workflows',
  steps: [
    {
      title: 'Automações do CRM',
      body: 'Um workflow faz o trabalho repetitivo por você. Quando algo acontece, como um novo lead, o Steel segue os passos que você montou: atualizar, avisar, enviar e-mail ou WhatsApp.',
    },
    {
      target: 'workflows-new',
      title: 'Novo workflow',
      body: 'Dê um nome e comece em branco ou por um modelo pronto. Em seguida você abre o editor, onde monta o fluxo e o ativa quando estiver pronto.',
      placement: 'bottom',
    },
    {
      target: 'workflows-table',
      title: 'Seus workflows',
      body: 'Veja quais estão ativos e quais ainda são rascunho. Clique no nome de um workflow para abrir o editor.',
      placement: 'top',
    },
  ],
}
