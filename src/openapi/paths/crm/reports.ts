import { z } from 'zod'
import {
  CreateCrmDashboardFromTemplateSchema,
  CreateCrmDashboardSchema,
  CreateCrmDashboardTvLinkSchema,
  CreateCrmDashboardWidgetSchema,
  CrmDashboardWidgetLayoutBatchSchema,
  UpdateCrmDashboardSchema,
  UpdateCrmDashboardWidgetSchema,
} from '@/src/schemas/crm-dashboard.schema'
import {
  CreateCrmReportSchema,
  UpdateCrmReportSchema,
} from '@/src/schemas/crm-report.schema'
import { SalesMetricsQuerySchema } from '@/src/schemas/crm-sales-metrics.schema'
import { flag } from '../../common'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmDashboardDTO,
  CrmDashboardLookupsDTO,
  CrmDashboardTvLinkDTO,
  CrmDashboardWidgetDTO,
  CrmReportDataDTO,
  CrmReportDTO,
  CrmSalesMetricDTO,
} from '../../schemas/crm/reports'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
  notFoundError,
} from './shared'

/**
 * CRM · Relatórios e dashboards — `reports`, `dashboards` e widgets.
 *
 * Leituras/edições por ID checam a permissão no workspace e depois exigem
 * habilitado o módulo **dono** do registro (`module`), que nas rotas do CRM
 * é sempre `CRM`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Relatórios e dashboards']

const REPORT_ID = 'ID do relatório.'
const DASHBOARD_ID = 'ID do dashboard.'
const WIDGET_ID = 'ID do widget.'

const REPORT_NOT_FOUND = notFoundError(
  'CrmReport',
  'Relatório inexistente no workspace',
)
const DASHBOARD_NOT_FOUND = notFoundError(
  'CrmDashboard',
  'Dashboard inexistente no workspace',
)
const WIDGET_NOT_FOUND = notFoundError(
  'CrmDashboardWidget',
  'Widget inexistente neste dashboard',
)
const TV_LINK_NOT_FOUND: ErrorEntry = {
  code: 'CRM_TV_LINK_NOT_FOUND',
  when: 'Link inexistente, já revogado ou de outro dashboard',
}

const RUN_NOTE =
  'Cada dataset é lido pelo service da fonte com a permissão `VIEW` do usuário (e, para `whatsapp_*`, com o módulo Comunicação habilitado) — sem acesso a uma fonte, a execução falha com o erro dela (`403`).'

const RUN_ERRORS: ErrorEntry[] = [...CRM_ERRORS, REPORT_NOT_FOUND]

export const crmReportsRoutes: RouteConfig[] = [
  /* ------------------------------ relatórios ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/reports',
    tags: TAGS,
    summary: 'Listar relatórios',
    description: describe(
      'Relatórios do módulo CRM, na ordem de `position`.',
      crmAccess('reports', 'VIEW'),
    ),
    responses: {
      200: { description: 'Relatórios.', schema: z.array(CrmReportDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/reports',
    tags: TAGS,
    summary: 'Criar relatório',
    description: describe(
      [
        'Dois formatos:',
        '',
        '- **Simples** (legado): `source` + `columns` (+ `filters`, `groupBy`, `sort`) sobre uma única fonte;',
        '- **Mega relatório**: `query` com vários datasets combinados por `join` (mesclagem por chave, colunas `alias.campo`) ou `union` (empilhamento com colunas mapeadas), com agrupamento/agregação (`count`, `sum`, `avg`, `min`, `max`) e ordenação.',
        '',
        '`source`/`columns` continuam obrigatórios mesmo com `query`.',
      ].join('\n'),
      crmAccess('reports', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmReportSchema,
      example: {
        name: 'Oportunidades abertas',
        source: 'opportunity',
        columns: ['name', 'amount', 'stageId'],
        filters: [
          { field: 'name', operator: 'contains', value: 'ServiceDesk' },
        ],
        sort: { field: 'amount', direction: 'desc' },
      },
    },
    responses: {
      201: { description: 'Relatório criado.', schema: CrmReportDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/reports/{reportId}',
    tags: TAGS,
    summary: 'Detalhe do relatório',
    description: describe(
      'Definição do relatório (sem executar). Os dados vêm de `GET .../data`.',
      crmAccess('reports', 'VIEW'),
    ),
    params: { reportId: REPORT_ID },
    responses: { 200: { description: 'Relatório.', schema: CrmReportDTO } },
    errors: RUN_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/reports/{reportId}',
    tags: TAGS,
    summary: 'Atualizar relatório',
    description: describe(
      'Atualização parcial — informe ao menos um campo. `null` limpa `groupBy`, `sort` ou `query`.',
      crmAccess('reports', 'EDIT'),
    ),
    params: { reportId: REPORT_ID },
    consent: true,
    body: UpdateCrmReportSchema,
    responses: {
      200: { description: 'Relatório atualizado.', schema: CrmReportDTO },
    },
    errors: RUN_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/reports/{reportId}',
    tags: TAGS,
    summary: 'Excluir relatório',
    description: crmAccess('reports', 'DELETE'),
    params: { reportId: REPORT_ID },
    consent: true,
    responses: { 200: { description: 'Relatório excluído.', schema: null } },
    errors: RUN_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/reports/{reportId}/data',
    tags: TAGS,
    summary: 'Executar relatório',
    description: describe(
      'Executa a query do relatório e devolve colunas + linhas processadas (sem paginação).',
      RUN_NOTE,
      crmAccess('reports', 'VIEW'),
    ),
    params: { reportId: REPORT_ID },
    responses: {
      200: { description: 'Dados do relatório.', schema: CrmReportDataDTO },
    },
    errors: RUN_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/reports/{reportId}/export',
    tags: TAGS,
    summary: 'Exportar relatório',
    description: describe(
      'Executa o relatório e devolve o arquivo para download (fora do envelope JSON), com os rótulos das colunas no cabeçalho. `format=xlsx` (ou `excel`) gera planilha SpreadsheetML (`relatorio.xls`); qualquer outro valor, ou nenhum, gera CSV (`relatorio.csv`). Erros continuam no envelope JSON.',
      RUN_NOTE,
      crmAccess('reports', 'VIEW'),
    ),
    params: { reportId: REPORT_ID },
    query: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['csv', 'xlsx', 'excel'],
          description: 'Formato do arquivo (padrão CSV).',
        },
      },
    },
    responses: {
      200: {
        description:
          'Arquivo CSV (`text/csv`) ou SpreadsheetML (`application/vnd.ms-excel`), com `Content-Disposition: attachment`.',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
        example: 'Nome,Valor\nImplantação ServiceDesk,12000\n',
        headers: {
          'Content-Disposition': {
            description:
              '`attachment; filename="relatorio.csv"` (ou `relatorio.xls`).',
          },
        },
      },
    },
    errors: RUN_ERRORS,
  },

  /* ------------------------------ dashboards ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/dashboards',
    tags: TAGS,
    summary: 'Listar dashboards',
    description: describe(
      'Dashboards do módulo CRM, na ordem de `position`.',
      crmAccess('dashboards', 'VIEW'),
    ),
    responses: {
      200: { description: 'Dashboards.', schema: z.array(CrmDashboardDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/dashboards',
    tags: TAGS,
    summary: 'Criar dashboard',
    description: describe(
      'Cria um dashboard vazio; os widgets são adicionados depois.',
      crmAccess('dashboards', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmDashboardSchema,
      example: { title: 'Vendas do trimestre' },
    },
    responses: {
      201: { description: 'Dashboard criado.', schema: CrmDashboardDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}',
    tags: TAGS,
    summary: 'Obter dashboard',
    description: describe(
      'Título, telas (`settings.pages`) e rotação do modo TV (`settings.rotateSeconds`).',
      crmAccess('dashboards', 'VIEW'),
    ),
    params: { dashboardId: DASHBOARD_ID },
    responses: {
      200: { description: 'Dashboard.', schema: CrmDashboardDTO },
    },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/dashboards/lookups',
    tags: TAGS,
    summary: 'Nomes para os widgets',
    description: describe(
      'Pipelines, etapas (com categoria e cor) e membros (nome e foto) do workspace — os gráficos e tabelas usam para mostrar nomes no lugar dos IDs de `stageId`, `pipelineId`, `ownerId` e `assigneeId`.',
      crmAccess('dashboards', 'VIEW'),
    ),
    responses: {
      200: { description: 'Nomes.', schema: CrmDashboardLookupsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/dashboards/templates',
    tags: TAGS,
    summary: 'Criar dashboard a partir de modelo',
    description: describe(
      '`sales-tv` cria o painel "Vendas — TV": o kit de Vendas em duas telas (metas e ranking; pipeline e funil) que alternam a cada 30 s no modo TV.',
      crmAccess('dashboards', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmDashboardFromTemplateSchema,
      example: { template: 'sales-tv' },
    },
    responses: {
      201: { description: 'Dashboard criado.', schema: CrmDashboardDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}',
    tags: TAGS,
    summary: 'Renomear dashboard',
    description: crmAccess('dashboards', 'EDIT'),
    params: { dashboardId: DASHBOARD_ID },
    consent: true,
    body: {
      schema: UpdateCrmDashboardSchema,
      example: {
        settings: { pages: ['Metas', 'Pipeline'], rotateSeconds: 30 },
      },
    },
    responses: {
      200: { description: 'Dashboard atualizado.', schema: CrmDashboardDTO },
    },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}',
    tags: TAGS,
    summary: 'Excluir dashboard',
    description: crmAccess('dashboards', 'DELETE'),
    params: { dashboardId: DASHBOARD_ID },
    consent: true,
    responses: { 200: { description: 'Dashboard excluído.', schema: null } },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND],
  },

  /* -------------------------------- widgets ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/widgets',
    tags: TAGS,
    summary: 'Listar widgets do dashboard',
    description: crmAccess('dashboards', 'VIEW'),
    params: { dashboardId: DASHBOARD_ID },
    responses: {
      200: { description: 'Widgets.', schema: z.array(CrmDashboardWidgetDTO) },
    },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/widgets',
    tags: TAGS,
    summary: 'Adicionar widget',
    description: describe(
      '`type` define o formato de `config`: `CHART` (gráfico sobre uma fonte do CRM ou `socials`), `VIEW` (tabela de uma fonte), `IFRAME` (`url`), `RICH_TEXT` (`html`) ou `SALES` (widget do kit de Vendas, só em dashboards do CRM). Posição/tamanho no grid de 12 colunas em `x`, `y`, `w`, `h`; `page` é a tela (0 a 2).',
      crmAccess('dashboards', 'CREATE'),
    ),
    params: { dashboardId: DASHBOARD_ID },
    consent: true,
    body: {
      schema: CreateCrmDashboardWidgetSchema,
      example: {
        type: 'CHART',
        config: {
          chartType: 'vertical',
          source: 'opportunities',
          xField: 'stageId',
          yField: 'amount',
        },
        x: 0,
        y: 0,
        w: 6,
        h: 6,
      },
    },
    responses: {
      201: { description: 'Widget criado.', schema: CrmDashboardWidgetDTO },
    },
    errors: [
      ...CRM_ERRORS,
      DASHBOARD_NOT_FOUND,
      {
        code: 'CRM_SALES_WIDGET_UNSUPPORTED',
        when: 'Widget `SALES` num dashboard que não é do CRM',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/widgets/layout',
    tags: TAGS,
    summary: 'Salvar layout dos widgets',
    description: describe(
      'Atualiza em lote posição e tamanho dos widgets (drag/resize do grid). Responde `202`.',
      crmAccess('dashboards', 'EDIT'),
    ),
    params: { dashboardId: DASHBOARD_ID },
    body: {
      schema: CrmDashboardWidgetLayoutBatchSchema,
      example: {
        items: [{ id: 'ckw1wdgt0000ab7d3k1e5xyz', x: 0, y: 0, w: 6, h: 6 }],
      },
    },
    responses: {
      202: { description: 'Layout aplicado.', schema: flag('applied') },
    },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/widgets/{widgetId}',
    tags: TAGS,
    summary: 'Atualizar widget',
    description: describe(
      'Atualização parcial de `x`, `y`, `w`, `h` e `config`. O `type` não muda; `config` é validado contra o tipo do widget.',
      crmAccess('dashboards', 'EDIT'),
    ),
    params: { dashboardId: DASHBOARD_ID, widgetId: WIDGET_ID },
    consent: true,
    body: UpdateCrmDashboardWidgetSchema,
    responses: {
      200: { description: 'Widget atualizado.', schema: CrmDashboardWidgetDTO },
    },
    errors: [
      ...CRM_ERRORS,
      DASHBOARD_NOT_FOUND,
      WIDGET_NOT_FOUND,
      {
        code: 'VALIDATION_ERROR',
        message: 'Config inválida para este tipo de widget',
        when: '`config` não confere com o tipo do widget',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/widgets/{widgetId}',
    tags: TAGS,
    summary: 'Remover widget',
    description: crmAccess('dashboards', 'DELETE'),
    params: { dashboardId: DASHBOARD_ID, widgetId: WIDGET_ID },
    consent: true,
    responses: { 200: { description: 'Widget removido.', schema: null } },
    errors: [...CRM_ERRORS, DASHBOARD_NOT_FOUND, WIDGET_NOT_FOUND],
  },

  /* --------------------------------- vendas -------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sales-metrics',
    tags: TAGS,
    summary: 'Métrica do kit de Vendas',
    description: describe(
      [
        'Calcula no servidor uma métrica do kit de Vendas (ADR 0031), no fuso do calendário padrão do workspace (ou `America/Sao_Paulo`). Um ganho conta no período em que a oportunidade entrou numa etapa `WON` (`wonAt`). Dias úteis: segunda a sexta, menos os feriados do calendário padrão.',
        '',
        '- `goal`: ganho do período × soma das metas, % atingido, falta, dias úteis restantes, necessário por dia e ritmo (projeção);',
        '- `ranking`: vendedores por valor ganho e % da meta individual;',
        '- `pipeline`: abertas por etapa (valor e ponderado = valor × probabilidade) de um pipeline;',
        '- `forecast`: comprometido (≥ 70%), melhor cenário e ponderado das que fecham no período;',
        '- `conversion`: lead → oportunidade → ganho, período atual × anterior;',
        '- `deal-stats`: ticket médio e ciclo médio (dias da criação ao ganho), com tendência;',
        '- `stalled`: abertas sem atividade há `stalledDays` dias;',
        '- `proposals`: enviadas/vistas aguardando resposta e as que vencem nesta semana;',
        '- `scoreboard`: placar de hoje (ganhos, valor, reuniões, atividades, leads novos por origem);',
        '- `wins-feed`: últimos ganhos (30 dias).',
      ].join('\n'),
      crmAccess('opportunities', 'VIEW'),
    ),
    query: SalesMetricsQuerySchema,
    responses: {
      200: { description: 'Métrica.', schema: CrmSalesMetricDTO },
    },
    errors: CRM_ERRORS,
  },

  /* ------------------------------- link da TV ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/tv-links',
    tags: TAGS,
    summary: 'Listar links da TV',
    description: describe(
      'Links ativos (não revogados) do modo TV deste dashboard.',
      crmAccess('privileged'),
    ),
    params: { dashboardId: DASHBOARD_ID },
    responses: {
      200: {
        description: 'Links.',
        schema: z.array(CrmDashboardTvLinkDTO),
      },
    },
    errors: [...CRM_PRIVILEGED_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/tv-links',
    tags: TAGS,
    summary: 'Criar link da TV',
    description: describe(
      'Gera um link somente leitura (`/tv/<token>`, 192 bits aleatórios) para abrir o painel numa TV sem login. A tela lê os dados em nome de quem criou o link: se essa pessoa sair do workspace, o link para de funcionar.',
      crmAccess('privileged'),
    ),
    params: { dashboardId: DASHBOARD_ID },
    consent: true,
    body: {
      schema: CreateCrmDashboardTvLinkSchema,
      example: { name: 'TV da sala de vendas' },
    },
    responses: {
      201: { description: 'Link criado.', schema: CrmDashboardTvLinkDTO },
    },
    errors: [...CRM_PRIVILEGED_ERRORS, DASHBOARD_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/dashboards/{dashboardId}/tv-links/{linkId}',
    tags: TAGS,
    summary: 'Revogar link da TV',
    description: describe(
      'A tela que usa o link para na próxima atualização.',
      crmAccess('privileged'),
    ),
    params: { dashboardId: DASHBOARD_ID, linkId: 'ID do link.' },
    consent: true,
    responses: { 200: { description: 'Link revogado.', schema: null } },
    errors: [...CRM_PRIVILEGED_ERRORS, DASHBOARD_NOT_FOUND, TV_LINK_NOT_FOUND],
  },
]
