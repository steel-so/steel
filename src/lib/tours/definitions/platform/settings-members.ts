import type { TourDefinition } from '../../types'

export const settingsMembersTour: TourDefinition = {
  key: 'platform.settings.members',
  version: 1,
  module: 'platform',
  title: 'Membros do workspace',
  description: 'Convidar pessoas, definir o cargo de cada uma e acompanhar.',
  route: '/settings/members',
  audience: 'admin',
  docsHref: '/docs/comecando/membros-e-papeis',
  steps: [
    {
      target: 'members-seats',
      title: 'Assentos do plano',
      body: 'Cada membro e cada convite pendente ocupa um assento. Aqui você vê quantos estão em uso e quantos o plano permite.',
      placement: 'bottom',
    },
    {
      target: 'members-invite',
      title: 'Convidar uma pessoa',
      body: 'Informe o e-mail e escolha o cargo: Administrador, Membro ou Visualizador. A pessoa recebe o convite, que vale por 7 dias.',
      placement: 'bottom',
    },
    {
      target: 'members-import',
      title: 'Convidar várias de uma vez',
      body: 'Importar CSV envia convites em lote a partir de uma planilha com a coluna de e-mail e, se quiser, a de cargo.',
      placement: 'bottom',
    },
    {
      target: 'members-table',
      title: 'Quem está no workspace',
      body: 'A lista mostra o cargo de cada pessoa: Dono, Administrador, Membro ou Visualizador. Use a busca e o filtro de cargos para localizar alguém.',
      placement: 'top',
    },
    {
      target: 'members-pending',
      title: 'Convites pendentes',
      body: 'Aqui você acompanha os convites que ainda não foram aceitos, reenvia, troca o cargo ou revoga. Esta área aparece quando há convites abertos.',
      placement: 'top',
    },
  ],
}
