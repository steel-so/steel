import type { TourDefinition } from '../../../types'

export const cadencesTour: TourDefinition = {
  key: 'crm.cadences',
  version: 1,
  module: 'crm',
  title: 'Cadências de vendas',
  description:
    'Sequências de contato por lead, com intervalos entre os passos.',
  route: '/crm/cadences',
  docsHref: '/docs/crm/cadencias-de-vendas',
  steps: [
    {
      target: 'cadence-intro',
      title: 'Contato lead a lead',
      body: 'Uma cadência é uma sequência de e-mails, WhatsApp e tarefas. Cada lead segue o próprio relógio e a cadência para sozinha quando ele responde.',
      placement: 'bottom',
    },
    {
      target: 'cadence-new',
      title: 'Nova cadência',
      body: 'Abre o editor: nome, passos e o intervalo entre eles. Cada passo é um e-mail, uma mensagem de WhatsApp ou uma tarefa, e você define quando parar.',
      placement: 'bottom',
    },
    {
      target: 'cadence-list',
      title: 'Suas cadências',
      body: 'Cada cartão mostra os passos, quantos leads foram inscritos e quantos responderam. Ative ou pause, edite, abra as estatísticas ou arquive.',
      placement: 'top',
    },
    {
      title: 'Inscrever leads',
      body: 'A inscrição é feita na tela de Leads, não aqui. Depois de criar a cadência, abra um lead e escolha a cadência para começar o contato.',
    },
  ],
}
