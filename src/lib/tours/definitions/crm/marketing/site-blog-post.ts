import type { TourDefinition } from '../../../types'

export const siteBlogPostTour: TourDefinition = {
  key: 'crm.sites.blog-post',
  version: 1,
  module: 'crm',
  title: 'Editor de post do blog',
  description: 'Escreva o post, escolha a capa, ajuste a busca e publique.',
  route: '/crm/sites/:siteId/blog/:postId',
  openFrom: '/crm/sites',
  steps: [
    {
      title: 'Escreva e publique um post',
      body: 'O texto fica no centro e os ajustes do post, na lateral. Nada vai ao ar enquanto o post estiver como rascunho.',
    },
    {
      target: 'site-blog-title',
      title: 'Título e texto',
      body: 'Digite o título aqui e escreva o texto logo abaixo. No editor você formata, adiciona imagens, listas e links como em qualquer documento.',
      placement: 'bottom',
    },
    {
      target: 'site-blog-ai',
      title: 'Ajuda da IA',
      body: 'Escreva um rascunho inteiro a partir de um tema, peça sugestões de título, gere o resumo ou transforme o post em perguntas e respostas. Revise antes de salvar.',
      placement: 'bottom',
    },
    {
      target: 'site-blog-cover',
      title: 'Imagem de capa',
      body: 'A capa aparece no topo do post e vira a imagem quando o link é compartilhado nas redes sociais. Escolha da biblioteca de mídia ou envie uma nova.',
      placement: 'left',
    },
    {
      target: 'site-blog-seo',
      title: 'Aparecer nos buscadores',
      body: 'Defina o título e a descrição que o Google mostra, além da palavra-chave principal. Se deixar vazio, o Steel usa o título e o resumo do post.',
      placement: 'left',
    },
    {
      target: 'site-blog-date',
      title: 'Data de publicação',
      body: 'Vazio, o post é publicado na hora. Com uma data futura, use Publicar e escolha Agendar para o post entrar no ar sozinho nesse dia e horário.',
      placement: 'left',
    },
    {
      target: 'site-blog-publish',
      title: 'Salvar e publicar',
      body: 'Salvar guarda o rascunho. Publicar abre as opções: publicar agora ou agendar. Depois de publicado, o botão permite atualizar o post ou voltar para rascunho.',
      placement: 'bottom',
    },
  ],
}
