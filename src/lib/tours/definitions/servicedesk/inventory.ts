import type { TourDefinition } from '../../types'

export const inventoryTour: TourDefinition = {
  key: 'servicedesk.inventory',
  version: 1,
  module: 'servicedesk',
  title: 'Inventário',
  description: 'Equipamentos, alertas e software descobertos na rede.',
  route: '/servicedesk/inventory',
  docsHref: '/docs/servicedesk/inventario-de-ativos',
  steps: [
    {
      target: 'sd-inventory-summary',
      title: 'Resumo',
      body: 'Quantos equipamentos existem, quantos têm agente, quantos foram descobertos por SNMP, quantos esperam adoção, quantos estão sem sinal e os alertas abertos.',
      placement: 'bottom',
    },
    {
      target: 'sd-inventory-tabs',
      title: 'Equipamentos, alertas e software',
      body: 'Equipamentos lista as máquinas, Alertas mostra problemas de disco e memória, e Software mostra os programas instalados.',
      placement: 'bottom',
    },
    {
      target: 'sd-table-search',
      title: 'Busca',
      body: 'Procure um equipamento por nome, número de série, sistema ou IP.',
      placement: 'bottom',
    },
    {
      target: 'sd-table-filter',
      title: 'Filtros',
      body: 'Filtre pela origem do dado, por alertas abertos e pela situação. Há uma opção só com os descobertos, que ainda precisam ser adotados.',
      placement: 'bottom',
    },
  ],
}
