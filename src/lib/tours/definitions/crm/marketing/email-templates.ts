import type { TourDefinition } from '../../../types'

export const emailTemplatesTour: TourDefinition = {
  key: 'crm.email-templates',
  version: 1,
  module: 'crm',
  title: 'Templates de e-mail',
  description: 'Crie e organize os modelos de e-mail usados nas campanhas.',
  route: '/crm/email-templates',
  steps: [
    {
      title: 'Modelos de e-mail',
      body: 'Um template é um e-mail pronto, já com a identidade visual da empresa. Você o escolhe ao montar uma campanha e pode reaproveitá-lo quantas vezes quiser.',
    },
    {
      target: 'email-templates-new',
      title: 'Novo template',
      body: 'Abre a galeria de modelos prontos, ou um e-mail em branco, e depois o editor visual onde você arrasta blocos, textos e imagens.',
      placement: 'bottom',
    },
    {
      target: 'email-templates-table',
      title: 'Seus templates',
      body: 'Use a busca para achar um template. Clique numa linha para abrir o editor e continuar de onde parou. O selo Novo editor marca os feitos no editor visual.',
      placement: 'top',
    },
  ],
}
