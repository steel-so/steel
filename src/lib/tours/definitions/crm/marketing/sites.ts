import type { TourDefinition } from '../../../types'

export const sitesTour: TourDefinition = {
  key: 'crm.sites',
  version: 1,
  module: 'crm',
  title: 'Sites',
  description:
    'Crie um site a partir de um modelo e acompanhe os que já existem.',
  route: '/crm/sites',
  steps: [
    {
      title: 'Seus sites e páginas',
      body: 'Aqui ficam os sites e as páginas de captação da empresa. Você monta tudo com um editor visual, publica em um clique e os contatos que chegam viram leads no CRM.',
    },
    {
      target: 'sites-new',
      title: 'Novo site',
      body: 'Abre a galeria: gerar com IA a partir de uma descrição do negócio, começar em branco ou escolher um modelo pronto. Depois você só dá um nome e cai direto no editor.',
      placement: 'bottom',
    },
    {
      target: 'sites-grid',
      title: 'Um cartão por site',
      body: 'Clique na miniatura para abrir o editor. No menu de três pontos ficam a visualização do rascunho, as métricas, os testes A/B, copiar o endereço, duplicar e excluir.',
      placement: 'top',
    },
    {
      title: 'Endereço do site',
      body: 'O endereço fica nas configurações do site: dentro do editor, clique no nome do site, no alto da tela. O cartão mostra o endereço atual e se o site está no ar ou em rascunho.',
    },
  ],
}
