import type { TourDefinition } from '../../../types'

export const crmLeadsTour: TourDefinition = {
  key: 'crm.leads',
  version: 1,
  module: 'crm',
  title: 'Leads e menu do CRM',
  description: 'Acompanhe cada lead por etapa, até virar uma oportunidade.',
  route: '/crm/leads',
  docsHref: '/docs/crm/leads',
  steps: [
    {
      title: 'Seus leads em um quadro',
      body: 'Lead é uma pessoa ou empresa que demonstrou interesse. Aqui você vê todos organizados por etapa e acompanha cada um até o fechamento.',
    },
    {
      target: 'crm-home-leads',
      title: 'Menu do CRM',
      body: 'Neste menu ficam Leads, Oportunidades, Empresas, Pessoas e Pipelines, além de tarefas, documentos, Marketing, Social, Painéis e Relatórios.',
      placement: 'right',
    },
    {
      target: 'leads-board',
      title: 'Etapas do funil',
      body: 'Cada coluna é uma etapa, de "Lead recebido" a "Fechado/Encerrado". Clique em um card para abrir o lead e ver o que falta para ele avançar.',
      placement: 'top',
    },
    {
      target: 'leads-search',
      title: 'Buscar leads',
      body: 'Digite um nome, empresa ou e-mail para achar um lead rapidamente. A busca filtra o quadro enquanto você escreve.',
      placement: 'bottom',
    },
    {
      target: 'leads-filter',
      title: 'Filtrar e ordenar',
      body: 'Em "Filtrar" você refina por campo, como empresa, cidade ou origem. Em "Ordenar" pode listar por Pontuação para atender primeiro os leads mais quentes.',
      placement: 'bottom',
    },
    {
      target: 'leads-apollo',
      title: 'Trazer leads prontos',
      body: 'Use "Importar da Apollo" para buscar contatos por filtros, ou "Importar CSV" para subir uma planilha sua. Os contatos importados passam a aparecer no quadro.',
      placement: 'bottom',
    },
    {
      target: 'leads-new',
      title: 'Cadastrar um lead',
      body: 'Clique em "Novo lead" para registrar à mão quem acabou de falar com você. Leads de formulários e páginas do site também chegam aqui sozinhos.',
      placement: 'bottom',
    },
  ],
}
