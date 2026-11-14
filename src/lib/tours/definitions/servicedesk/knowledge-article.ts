import type { TourDefinition } from '../../types'

export const knowledgeArticleTour: TourDefinition = {
  key: 'servicedesk.knowledge.article',
  version: 1,
  module: 'servicedesk',
  title: 'Editor de artigo',
  description: 'Escrever, revisar, definir validade e publicar um artigo.',
  route: '/servicedesk/knowledge/:articleId',
  openFrom: '/servicedesk/knowledge',
  docsHref: '/docs/servicedesk/base-de-conhecimento',
  steps: [
    {
      title: 'Do chamado ao artigo',
      body: 'Para virar artigo uma solução que você acabou de dar, abra a aba Conhecimento do chamado e use Criar artigo deste chamado. O rascunho já vem escrito.',
    },
    {
      target: 'sd-kb-editor',
      title: 'Escreva o artigo',
      body: 'Dê um título, escolha ícone e capa se quiser e escreva o texto. Tudo é salvo sozinho enquanto você digita.',
      placement: 'top',
    },
    {
      target: 'sd-kb-article-preview',
      title: 'Visualizar',
      body: 'Mostra o artigo como o leitor vai ver. Clique de novo, em Editar, para voltar a escrever.',
      placement: 'bottom',
    },
    {
      target: 'sd-kb-article-publish',
      title: 'Publicar',
      body: 'Alterna o artigo entre rascunho e publicado. Enquanto for rascunho, só quem edita a base enxerga.',
      placement: 'bottom',
    },
    {
      target: 'sd-kb-article-details',
      title: 'Revisão e detalhes',
      body: 'Abre um painel. Em Revisão ficam as etapas até publicar, a validade da revisão e quantos chamados o artigo ajudou a resolver. Em Propriedades, a visibilidade, a categoria e as tags.',
      placement: 'bottom',
    },
  ],
}
