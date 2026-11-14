import type { TourDefinition } from '../../types'

export const homeTour: TourDefinition = {
  key: 'platform.home',
  version: 1,
  module: 'platform',
  title: 'Conheça o Steel',
  description: 'Onde ficam os módulos, a busca, os avisos e a ajuda.',
  route: '',
  docsHref: '/docs/comecando',
  steps: [
    {
      title: 'Bem-vindo ao Steel',
      body: 'Em menos de um minuto você vê onde fica cada coisa. Dá para pular agora e rever depois pelo botão "Ver tour".',
    },
    {
      target: 'app-modules',
      title: 'Módulos',
      body: 'Aqui você troca entre ServiceDesk, CRM, Comunicação, Wiki e Steel AI. Só aparecem os módulos liberados para você.',
      placement: 'right',
    },
    {
      target: 'app-workspace',
      title: 'Workspace',
      body: 'O workspace é o espaço da sua empresa. Se você participa de mais de um, troque por aqui.',
      placement: 'bottom',
    },
    {
      target: 'app-search',
      title: 'Busca',
      body: 'Encontre chamados, contatos, páginas e telas de qualquer módulo. Você também pode fazer uma pergunta ao Steel AI daqui.',
      placement: 'bottom',
    },
    {
      target: 'app-inbox',
      title: 'Caixa de entrada',
      body: 'Menções, atribuições e avisos chegam aqui, com um contador do que ainda não foi lido.',
      placement: 'bottom',
    },
    {
      target: 'app-help',
      title: 'Ajuda e tours',
      body: 'Manual, suporte, atalhos do teclado e a lista de todos os tours guiados ficam neste menu.',
      placement: 'bottom',
    },
  ],
}
