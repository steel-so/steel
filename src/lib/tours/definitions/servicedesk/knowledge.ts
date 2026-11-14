import type { TourDefinition } from '../../types'

export const knowledgeTour: TourDefinition = {
  key: 'servicedesk.knowledge',
  version: 1,
  module: 'servicedesk',
  title: 'Base de conhecimento',
  description: 'Artigos e soluções que ajudam a resolver chamados mais rápido.',
  route: '/servicedesk/knowledge',
  docsHref: '/docs/servicedesk/base-de-conhecimento',
  steps: [
    {
      title: 'Respostas à mão',
      body: 'A base reúne procedimentos e soluções conhecidas. Quem atende resolve mais rápido, e o solicitante encontra a resposta antes de abrir um chamado.',
    },
    {
      target: 'sd-kb-new',
      title: 'Novo artigo',
      body: 'Cria um rascunho em branco e abre o editor. O artigo só aparece para os outros depois de publicado.',
      placement: 'bottom',
    },
    {
      target: 'sd-kb-search',
      title: 'Busca',
      body: 'Digite o assunto e aperte Enter. A busca olha título e texto dos artigos e mostra um trecho de cada resultado.',
      placement: 'bottom',
    },
    {
      target: 'sd-kb-categories',
      title: 'Categorias',
      body: 'Clique numa categoria para ver só os artigos dela. Clique de novo para voltar a ver todos.',
      placement: 'bottom',
    },
    {
      target: 'sd-kb-curation',
      title: 'Curadoria',
      body: 'Mostra quantos chamados a base já resolveu, o que espera a sua revisão e os artigos com revisão vencida. Só quem atende vê esta parte.',
      placement: 'top',
    },
    {
      target: 'sd-kb-lists',
      title: 'Em destaque',
      body: 'Os artigos atualizados há pouco, os mais vistos e os mais úteis, segundo os votos de quem leu.',
      placement: 'top',
    },
  ],
}
