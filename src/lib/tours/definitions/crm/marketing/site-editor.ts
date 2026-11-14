import type { TourDefinition } from '../../../types'

export const siteEditorTour: TourDefinition = {
  key: 'crm.sites.editor',
  version: 1,
  module: 'crm',
  title: 'Editor de site',
  description: 'Monte as páginas com blocos, ajuste cada detalhe e publique.',
  route: '/crm/sites/:siteId',
  openFrom: '/crm/sites',
  desktopOnly: true,
  mobileSummary:
    'O editor de sites é visual e precisa de uma tela maior. Abra esta página em um computador ou tablet para montar as páginas, ajustar o celular e publicar.',
  steps: [
    {
      title: 'Monte o site arrastando',
      body: 'Você escolhe blocos na lateral, solta na página e ajusta cada um à direita. O que você muda é salvo sozinho; o site só vai ao ar quando você clicar em Publicar.',
    },
    {
      target: 'site-editor-settings',
      title: 'Nome e endereço do site',
      body: 'Clique no nome do site para abrir as configurações: nome, endereço, título e descrição para os buscadores, ícone e códigos de acompanhamento.',
      placement: 'bottom',
    },
    {
      target: 'site-editor-pages',
      title: 'Página em edição',
      body: 'Troque aqui entre as páginas do site e os itens que se repetem em todas elas, como o cabeçalho e o rodapé. A página atual é salva antes da troca.',
      placement: 'bottom',
    },
    {
      target: 'canvas-sidebar',
      title: 'Blocos, seções e páginas',
      body: 'Em Adicionar estão os elementos soltos; em Seções prontas, partes inteiras como destaque e preços. Camadas mostra a estrutura. Páginas, Tema e Mídia ficam nas outras abas.',
      placement: 'right',
    },
    {
      target: 'canvas-stage',
      title: 'A página',
      body: 'Arraste um bloco da lateral até aqui. Clique em qualquer elemento para selecionar, mexa nos textos direto na página e reordene arrastando.',
      placement: 'left',
    },
    {
      target: 'canvas-inspector',
      title: 'Propriedades',
      body: 'Ao selecionar um elemento, aqui você muda cores, tamanhos, espaçamentos e links. Sem nada selecionado, aparecem os ajustes da página inteira.',
      placement: 'left',
    },
    {
      target: 'canvas-toolbar',
      title: 'Celular, tablet e computador',
      body: 'Alterne entre Desktop, Tablet e Celular para ver e ajustar como o site fica em cada tela. Aqui também ficam o zoom e os botões de desfazer e refazer.',
      placement: 'bottom',
    },
    {
      target: 'site-editor-publish',
      title: 'Publicar',
      body: 'Antes de ir ao ar, o Steel mostra o que vai mudar: páginas, cabeçalho e rodapé. Use o ícone de olho ao lado para ver o rascunho sem publicar.',
      placement: 'bottom',
    },
  ],
}
