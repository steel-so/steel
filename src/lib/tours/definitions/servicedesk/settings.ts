import type { TourDefinition } from '../../types'

export const settingsTour: TourDefinition = {
  key: 'servicedesk.settings',
  version: 1,
  module: 'servicedesk',
  title: 'Configurações do ServiceDesk',
  description:
    'Fluxos, catálogo, prioridades, SLA e automações do atendimento.',
  route: '/servicedesk/settings',
  audience: 'admin',
  docsHref: '/docs/servicedesk/configuracoes',
  steps: [
    {
      title: 'Como o atendimento funciona',
      body: 'Aqui você define as regras do ServiceDesk. O menu à esquerda tem uma seção para cada assunto. Veja as principais.',
    },
    {
      target: 'sd-settings-flows',
      title: 'Fluxos',
      body: 'As fases de cada tipo de chamado, com porcentagem de conclusão, pausa do SLA, aprovação e campos obrigatórios.',
      placement: 'right',
    },
    {
      target: 'sd-settings-catalog',
      title: 'Catálogo',
      body: 'O catálogo de serviços: categoria, subcategoria e serviço, com o time e o SLA padrão de cada um.',
      placement: 'right',
    },
    {
      target: 'sd-settings-priorities',
      title: 'Prioridades',
      body: 'Impacto, urgência, prioridade e severidade, e a matriz que cruza impacto e urgência para chegar à prioridade do chamado.',
      placement: 'right',
    },
    {
      target: 'sd-settings-sla',
      title: 'SLA e calendário',
      body: 'As políticas de SLA com a meta de cada prioridade e os calendários de expediente, com feriados. O prazo só corre dentro do expediente.',
      placement: 'right',
    },
    {
      target: 'sd-settings-automations',
      title: 'Automações',
      body: 'Regras no formato evento, condições e ações, executadas na ordem da lista. Servem para atribuir, avisar e mudar chamados sozinhas.',
      placement: 'right',
    },
    {
      target: 'sd-settings-section',
      title: 'A seção aberta',
      body: 'A seção escolhida aparece aqui, com uma frase sobre o que ela faz. Quem não é administrador vê tudo, mas só em leitura.',
      placement: 'bottom',
    },
  ],
}
