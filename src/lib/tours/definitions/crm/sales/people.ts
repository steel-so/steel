import type { TourDefinition } from '../../../types'

export const crmPeopleTour: TourDefinition = {
  key: 'crm.people',
  version: 1,
  module: 'crm',
  title: 'Pessoas e empresas',
  description: 'Sua base de contatos e clientes, com filtros e histórico.',
  route: ['/crm/people', '/crm/companies'],
  docsHref: '/docs/crm/pessoas-e-empresas',
  steps: [
    {
      title: 'Sua base de relacionamento',
      body: 'Pessoas e empresas guardam os dados de quem você atende. Tudo o que acontece com cada uma, de ligações a propostas, fica reunido na ficha.',
    },
    {
      target: 'crm-table-search',
      title: 'Buscar',
      body: 'Digite um nome para achar o registro. Se preferir, pergunte em português na barra acima da tabela e o Steel monta o filtro por você.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-filter',
      title: 'Filtrar por coluna',
      body: 'Refine a lista por qualquer coluna da tabela e combine vários filtros. Eles ficam salvos para você na próxima visita.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-columns',
      title: 'Escolher as colunas',
      body: 'Mostre ou esconda colunas para ver só o que interessa. Campos personalizados que sua equipe criou também aparecem aqui.',
      placement: 'bottom',
    },
    {
      target: 'crm-import-csv',
      title: 'Importar uma planilha',
      body: 'Traga vários registros de uma vez enviando um arquivo CSV. Você vê uma prévia das linhas antes de confirmar a importação.',
      placement: 'bottom',
    },
    {
      target: 'crm-table-new',
      title: 'Cadastrar um registro',
      body: 'Use o botão de novo registro para adicionar uma pessoa ou empresa à mão, preenchendo só o essencial.',
      placement: 'bottom',
    },
    {
      title: 'A ficha e a linha do tempo',
      body: 'Clique em uma linha para abrir a ficha. Nela ficam os botões de contato, documentos vinculados e a linha do tempo com cada interação.',
    },
  ],
}
