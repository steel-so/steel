import type { TourDefinition } from '../../../types'

export const mailingListsTour: TourDefinition = {
  key: 'crm.mailing-lists',
  version: 1,
  module: 'crm',
  title: 'Listas de e-mail',
  description: 'Agrupe leads em listas para usar como público nos envios.',
  route: '/crm/mailing-lists',
  steps: [
    {
      title: 'Para que servem as listas',
      body: 'Uma lista é um grupo de leads reunido por você, como clientes VIP ou participantes de um evento. Ela vira o público das campanhas.',
    },
    {
      target: 'mailing-lists-new',
      title: 'Nova lista',
      body: 'Dê um nome e, se quiser, uma descrição. Depois de criada, abra a lista e use Adicionar leads para buscar e incluir os contatos.',
      placement: 'bottom',
    },
    {
      target: 'mailing-lists-table',
      title: 'Suas listas',
      body: 'Veja o nome, quantos membros cada lista tem e quando foi criada. Clique numa linha para editar a lista ou mudar os membros.',
      placement: 'top',
    },
  ],
}
