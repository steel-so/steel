import type { TourDefinition } from '../../../types'

export const emailTemplatesNewTour: TourDefinition = {
  key: 'crm.email-templates.new',
  version: 1,
  module: 'crm',
  title: 'Escolher o ponto de partida',
  description: 'Comece um e-mail do zero ou de um modelo pronto.',
  route: '/crm/email-templates/new',
  steps: [
    {
      title: 'Por onde começar',
      body: 'Escolha um modelo pronto ou um e-mail em branco. Em qualquer caso, o editor abre em seguida e você muda tudo: textos, imagens, cores e a ordem dos blocos.',
    },
    {
      target: 'email-templates-categories',
      title: 'Categorias',
      body: 'Filtre os modelos por Marketing, Relacionamento, Vendas ou Eventos para achar mais rápido um que se pareça com o e-mail que você precisa.',
      placement: 'bottom',
    },
    {
      target: 'email-templates-blank',
      title: 'E-mail em branco',
      body: 'Uma coluna vazia e o rodapé. Escolha esta opção se preferir montar o e-mail do seu jeito, bloco a bloco.',
      placement: 'right',
    },
    {
      target: 'email-templates-starters',
      title: 'Modelos prontos',
      body: 'Clique em um modelo para usá-lo. Você dá um nome ao template e o editor abre com o modelo já na marca do workspace.',
      placement: 'top',
    },
  ],
}
