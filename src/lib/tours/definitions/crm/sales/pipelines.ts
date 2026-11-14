import type { TourDefinition } from '../../../types'

export const crmPipelinesTour: TourDefinition = {
  key: 'crm.pipelines',
  version: 1,
  module: 'crm',
  title: 'Pipelines',
  description: 'Crie funis de vendas e defina as etapas de cada um.',
  route: '/crm/pipelines',
  docsHref: '/docs/crm/oportunidades-e-funis',
  steps: [
    {
      title: 'Os funis da sua equipe',
      body: 'Um pipeline é o caminho que uma oportunidade percorre até ser ganha ou perdida. Você pode ter um funil para cada tipo de venda.',
    },
    {
      target: 'pipelines-new',
      title: 'Criar um funil',
      body: 'Clique em "Novo funil", dê um nome e confirme em "Criar funil". Depois é só montar as etapas dele.',
      placement: 'bottom',
    },
    {
      target: 'pipelines-list',
      title: 'Lista de funis',
      body: 'Clique em um funil para ver e editar as etapas dele. O ícone de lixeira remove o funil, mas a remoção pode ser recusada se houver negócios nele.',
      placement: 'right',
    },
    {
      target: 'pipelines-stage-new',
      title: 'Adicionar etapas',
      body: 'Escreva o nome da etapa, como "Proposta enviada", e clique em "Adicionar". Elas aparecem na ordem em que você criar.',
      placement: 'bottom',
    },
    {
      target: 'pipelines-stages',
      title: 'Nome e chance de fechar',
      body: 'Clique no nome para renomear a etapa. Clique na porcentagem para definir a chance de fechar o negócio ao chegar nela; a previsão de vendas usa esse número.',
      placement: 'left',
    },
  ],
}
