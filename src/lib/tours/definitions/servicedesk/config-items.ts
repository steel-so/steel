import type { TourDefinition } from '../../types'

export const configItemsTour: TourDefinition = {
  key: 'servicedesk.config-items',
  version: 1,
  module: 'servicedesk',
  title: 'Itens de configuração',
  description: 'O cadastro de servidores, equipamentos e serviços (CMDB).',
  route: '/servicedesk/config-items',
  docsHref: '/docs/servicedesk/catalogo-e-cadastros',
  steps: [
    {
      title: 'O cadastro da infraestrutura',
      body: 'Aqui ficam servidores, notebooks, links e outros itens que sustentam os serviços. Clique numa linha para abrir os detalhes do item.',
    },
    {
      target: 'sd-table-search',
      title: 'Busca',
      body: 'Procure por nome, código, número de série, modelo ou IP.',
      placement: 'bottom',
    },
    {
      target: 'sd-table-filter',
      title: 'Filtros',
      body: 'Filtre por tipo, status, criticidade, garantia vencendo e cliente ou empresa.',
      placement: 'bottom',
    },
    {
      target: 'sd-table-columns',
      title: 'Colunas',
      body: 'Escolha quais colunas aparecer na tabela. A sua escolha fica guardada neste navegador.',
      placement: 'bottom',
    },
    {
      target: 'sd-ci-new',
      title: 'Novo item',
      body: 'Cadastre um item novo. Depois, é possível ligá-lo a chamados e a outros itens, como o servidor de um sistema.',
      placement: 'bottom',
    },
    {
      target: 'sd-ci-types',
      title: 'Tipos de item',
      body: 'Ajuste os tipos de item, como servidor, notebook ou link. Só administradores veem este botão.',
      placement: 'bottom',
    },
  ],
}
