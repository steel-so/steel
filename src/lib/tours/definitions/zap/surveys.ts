import type { TourDefinition } from '../../types'

export const surveysTour: TourDefinition = {
  key: 'zap.surveys',
  version: 1,
  module: 'zap',
  title: 'Pesquisas de satisfação',
  description: 'Meça a satisfação dos clientes depois do atendimento.',
  route: '/zap/pesquisas',
  docsHref: '/docs/comunicacao/pesquisas',
  steps: [
    {
      target: 'zap-surveys-tabs',
      title: 'Resultados, envios e regras',
      body: '"Resultados" resume as notas, "Envios" lista cada pesquisa enviada e "Regras" define quando a pesquisa sai e qual formato ela usa.',
      placement: 'bottom',
    },
    {
      target: 'zap-surveys-filters',
      title: 'Escolha o que analisar',
      body: 'Troque o tipo de pesquisa, agrupe por atendente ou por equipe e mude o período. Os números abaixo se ajustam na hora.',
      placement: 'bottom',
    },
    {
      title: 'Ligar uma pesquisa',
      body: 'Em "Regras" você ativa cada gatilho, como conversa encerrada, e escolhe o tipo, o atraso do envio e o intervalo para não repetir ao mesmo cliente.',
    },
  ],
}
