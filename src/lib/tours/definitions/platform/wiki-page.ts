import type { TourDefinition } from '../../types'

export const wikiPageTour: TourDefinition = {
  key: 'platform.wiki.page',
  version: 1,
  module: 'platform',
  title: 'Página da Wiki',
  description: 'Publicar, bloquear, formatar e usar a IA dentro de uma página.',
  route: '/wiki/:wikiId',
  openFrom: '/wiki',
  docsHref: '/docs/workspace/wiki',
  steps: [
    {
      title: 'Uma página para a equipe',
      body: 'Várias pessoas podem editar esta página ao mesmo tempo, e as mudanças aparecem na hora para todo mundo.',
    },
    {
      target: 'wiki-publish',
      title: 'Publicar na web',
      body: 'Publicar cria um link público, só para leitura, que abre sem login. Para desligar o link depois, use Cancelar publicação.',
      placement: 'bottom',
    },
    {
      target: 'wiki-quick-actions',
      title: 'Bloquear, copiar e favoritar',
      body: 'Bloqueie a edição para deixar a página só para leitura, copie o link interno ou favorite a página para achá-la depressa.',
      placement: 'bottom',
    },
    {
      target: 'wiki-toolbar',
      title: 'Barra de formatação',
      body: 'Troque o tipo de bloco, aplique cores, negrito, listas, citações, tabelas e imagens. O botão Resumo com IA gera um resumo da página.',
      placement: 'bottom',
    },
    {
      title: 'IA em cada bloco',
      body: 'Passe o mouse sobre um bloco e clique no ícone de brilho à esquerda, IA neste bloco, para reescrever, simplificar, desenvolver ou resumir o trecho.',
    },
    {
      target: 'wiki-side-panel',
      title: 'Painel lateral',
      body: 'Estrutura mostra os títulos da página, Info traz estatísticas, etiquetas e quem editou, e Recursos lista as imagens e os arquivos.',
      placement: 'left',
    },
  ],
}
