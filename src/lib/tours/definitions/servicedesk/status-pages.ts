import type { TourDefinition } from '../../types'

export const statusPagesTour: TourDefinition = {
  key: 'servicedesk.status-pages',
  version: 1,
  module: 'servicedesk',
  title: 'Páginas de status',
  description: 'Páginas públicas que informam clientes durante falhas.',
  route: '/servicedesk/status-pages',
  docsHref: '/docs/servicedesk/incidente-maior',
  steps: [
    {
      target: 'sd-status-title',
      title: 'Avise seus clientes',
      body: 'Cada página pública é de um cliente ou serviço e mostra as atualizações dos incidentes maiores, com aviso por e-mail e WhatsApp.',
      placement: 'bottom',
    },
    {
      target: 'sd-status-new',
      title: 'Nova página',
      body: 'Cria uma página de status. Só administradores veem este botão.',
      placement: 'bottom',
    },
    {
      target: 'sd-status-list',
      title: 'Suas páginas',
      body: 'Cada página mostra o endereço público e se está publicada. Os botões abrem Componentes e Assinantes, e os administradores também podem editar e excluir.',
      placement: 'top',
    },
    {
      target: 'sd-status-maintenance',
      title: 'Manutenções programadas',
      body: 'Use Agendar manutenção para avisar com antecedência uma janela planejada. Os assinantes são avisados e o monitoramento pode deixar de abrir chamados nesse período.',
      placement: 'top',
    },
  ],
}
