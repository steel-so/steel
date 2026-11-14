import type { TourDefinition } from '../../types'

export const whiteboardBoardTour: TourDefinition = {
  key: 'platform.whiteboard.board',
  version: 1,
  module: 'platform',
  title: 'Quadro-branco',
  description: 'Desenhar, salvar versões e voltar no histórico de um quadro.',
  route: '/whiteboard/:boardId',
  openFrom: '/whiteboard',
  docsHref: '/docs/workspace/quadro-branco',
  desktopOnly: true,
  mobileSummary:
    'O quadro-branco é um espaço de desenho que funciona melhor em tela grande. Abra-o no computador para ver o passo a passo.',
  steps: [
    {
      target: 'whiteboard-canvas',
      title: 'Área de desenho',
      body: 'Use a barra de ferramentas no topo do quadro para desenhar formas, setas, texto e linhas livres. Cole ou arraste imagens para dentro dele.',
      placement: 'top',
    },
    {
      target: 'whiteboard-status',
      title: 'Salvamento automático',
      body: 'O quadro salva sozinho alguns segundos após cada mudança. Só uma pessoa edita por vez; as outras acompanham em modo leitura.',
      placement: 'bottom',
    },
    {
      target: 'whiteboard-history',
      title: 'Histórico de versões',
      body: 'Veja as versões anteriores, confira a prévia e restaure uma delas. Com Salvar versão você marca um momento importante, com ou sem nome.',
      placement: 'bottom',
    },
  ],
}
