import { z } from 'zod'
import {
  CreateCrmDashboardSchema,
  CreateCrmDashboardWidgetSchema,
  CrmDashboardWidgetLayoutBatchSchema,
  UpdateCrmDashboardSchema,
  UpdateCrmDashboardWidgetSchema,
} from '@/src/schemas/crm-dashboard.schema'
import {
  CreateCrmReportSchema,
  UpdateCrmReportSchema,
} from '@/src/schemas/crm-report.schema'
import { WA_DASHBOARD_SOURCES } from '@/src/schemas/whatsapp-dashboard.schema'
import { flag } from '../../common'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  WhatsAppDashboardDTO,
  WhatsAppDashboardRowDTO,
  WhatsAppDashboardWidgetDTO,
  WhatsAppReportDataDTO,
  WhatsAppReportDTO,
} from '../../schemas/whatsapp'
import { perm, permErrors } from './shared'

const TAG = 'Comunicação · Dashboards e relatórios' as const
const DASHBOARD = '/workspaces/{id}/whatsapp/dashboards/{dashboardId}'
const REPORT = '/workspaces/{id}/whatsapp/reports/{reportId}'
const DASHBOARD_PARAMS = { dashboardId: 'Id do dashboard.' }
const WIDGET_PARAMS = { ...DASHBOARD_PARAMS, widgetId: 'Id do widget.' }
const REPORT_PARAMS = { reportId: 'Id do relatório.' }

const ENGINE =
  'Usa o mesmo motor de dashboards/relatórios do CRM, escopado ao módulo `COMMUNICATION`.'

/**
 * Operações por id (`CrmDashboardService`/`CrmReportService`): membro com a
 * permissão + módulo **do próprio recurso** habilitado — o id não é
 * conferido contra `COMMUNICATION`.
 */
const BY_ID_NOTE =
  'A autorização confere a permissão e o módulo **do próprio recurso** (um id de dashboard/relatório do CRM também é aceito aqui).'

function byIdErrors(
  resource: 'dashboards' | 'reports',
  action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE',
  what: string,
): ErrorEntry[] {
  return [
    ...permErrors(resource, action),
    {
      code: 'RESOURCE_NOT_FOUND',
      message: `${what} not found`,
      when: `${what} inexistente no workspace`,
    },
  ]
}

const UNPARSED_JSON = 'Um corpo que não é JSON válido não é tratado (erro 500).'

export const dashboardRoutes: RouteConfig[] = [
  /* ------------------------------ dashboards ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/dashboards',
    tags: [TAG],
    summary: 'Listar dashboards',
    description: `Dashboards da Comunicação, na ordem definida pelo usuário (\`position\`). ${ENGINE} ${perm('dashboards', 'VIEW')}`,
    responses: {
      200: {
        description: 'Dashboards.',
        schema: z.array(WhatsAppDashboardDTO),
      },
    },
    errors: permErrors('dashboards', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/dashboards',
    tags: [TAG],
    summary: 'Criar dashboard',
    description: `Cria um dashboard vazio no módulo \`COMMUNICATION\`. Auditado. ${perm('dashboards', 'CREATE')}`,
    consent: true,
    body: CreateCrmDashboardSchema,
    responses: {
      201: { description: 'Dashboard criado.', schema: WhatsAppDashboardDTO },
    },
    errors: permErrors('dashboards', 'CREATE'),
  },
  {
    method: 'patch',
    path: DASHBOARD,
    tags: [TAG],
    summary: 'Renomear dashboard',
    description: `${BY_ID_NOTE} ${UNPARSED_JSON} Auditado. ${perm('dashboards', 'EDIT')}`,
    consent: true,
    params: DASHBOARD_PARAMS,
    body: UpdateCrmDashboardSchema,
    responses: {
      200: {
        description: 'Dashboard atualizado.',
        schema: WhatsAppDashboardDTO,
      },
    },
    errors: byIdErrors('dashboards', 'EDIT', 'CrmDashboard'),
  },
  {
    method: 'delete',
    path: DASHBOARD,
    tags: [TAG],
    summary: 'Excluir dashboard',
    description: `Exclui o dashboard e seus widgets. ${BY_ID_NOTE} Auditado. ${perm('dashboards', 'DELETE')}`,
    consent: true,
    params: DASHBOARD_PARAMS,
    responses: { 200: { description: 'Dashboard excluído.', schema: null } },
    errors: byIdErrors('dashboards', 'DELETE', 'CrmDashboard'),
  },
  {
    method: 'get',
    path: `${DASHBOARD}/widgets`,
    tags: [TAG],
    summary: 'Listar widgets',
    description: `Widgets do dashboard com posição/tamanho no grid (12 colunas) e configuração. ${BY_ID_NOTE} ${perm('dashboards', 'VIEW')}`,
    params: DASHBOARD_PARAMS,
    responses: {
      200: {
        description: 'Widgets.',
        schema: z.array(WhatsAppDashboardWidgetDTO),
      },
    },
    errors: byIdErrors('dashboards', 'VIEW', 'CrmDashboard'),
  },
  {
    method: 'post',
    path: `${DASHBOARD}/widgets`,
    tags: [TAG],
    summary: 'Criar widget',
    description: `Adiciona um widget, discriminado por \`type\`: \`CHART\` (gráfico sobre uma fonte — para a Comunicação, \`whatsapp-conversations\` e \`whatsapp-broadcasts\`), \`VIEW\` (tabela), \`IFRAME\` (URL embutida) ou \`RICH_TEXT\` (HTML). \`x\`/\`y\`/\`w\`/\`h\` posicionam no grid. ${BY_ID_NOTE} Auditado. ${perm('dashboards', 'CREATE')}`,
    consent: true,
    params: DASHBOARD_PARAMS,
    body: CreateCrmDashboardWidgetSchema,
    responses: {
      201: {
        description: 'Widget criado.',
        schema: WhatsAppDashboardWidgetDTO,
      },
    },
    errors: byIdErrors('dashboards', 'CREATE', 'CrmDashboard'),
  },
  {
    method: 'post',
    path: `${DASHBOARD}/widgets/layout`,
    tags: [TAG],
    summary: 'Salvar layout dos widgets',
    description: `Atualiza em lote posição e tamanho dos widgets (arrastar/redimensionar no grid; até 200 itens). ${BY_ID_NOTE} ${perm('dashboards', 'EDIT')}`,
    params: DASHBOARD_PARAMS,
    body: CrmDashboardWidgetLayoutBatchSchema,
    responses: {
      202: { description: 'Layout aplicado.', schema: flag('applied') },
    },
    errors: byIdErrors('dashboards', 'EDIT', 'CrmDashboard'),
  },
  {
    method: 'patch',
    path: `${DASHBOARD}/widgets/{widgetId}`,
    tags: [TAG],
    summary: 'Atualizar widget',
    description: `Atualização parcial de posição/tamanho e/ou \`config\` (validado contra o tipo do widget). ${BY_ID_NOTE} ${UNPARSED_JSON} Auditado. ${perm('dashboards', 'EDIT')}`,
    consent: true,
    params: WIDGET_PARAMS,
    body: UpdateCrmDashboardWidgetSchema,
    responses: {
      200: {
        description: 'Widget atualizado.',
        schema: WhatsAppDashboardWidgetDTO,
      },
    },
    errors: [
      ...byIdErrors('dashboards', 'EDIT', 'CrmDashboard'),
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'CrmDashboardWidget not found',
        when: 'Widget inexistente no dashboard',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Config inválida para este tipo de widget',
        when: '`config` não confere com o `type` do widget',
      },
    ],
  },
  {
    method: 'delete',
    path: `${DASHBOARD}/widgets/{widgetId}`,
    tags: [TAG],
    summary: 'Excluir widget',
    description: `${BY_ID_NOTE} Auditado. ${perm('dashboards', 'DELETE')}`,
    consent: true,
    params: WIDGET_PARAMS,
    responses: { 200: { description: 'Widget excluído.', schema: null } },
    errors: [
      ...byIdErrors('dashboards', 'DELETE', 'CrmDashboard'),
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'CrmDashboardWidget not found',
        when: 'Widget inexistente no dashboard',
      },
    ],
  },

  /* ------------------------------ relatórios ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/reports',
    tags: [TAG],
    summary: 'Listar relatórios',
    description: `Relatórios salvos da Comunicação, na ordem definida pelo usuário. ${ENGINE} ${perm('reports', 'VIEW')}`,
    responses: {
      200: { description: 'Relatórios.', schema: z.array(WhatsAppReportDTO) },
    },
    errors: permErrors('reports', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/reports',
    tags: [TAG],
    summary: 'Criar relatório',
    description: `Salva a definição de um relatório: forma simples (\`source\` + \`columns\` + \`filters\`/\`groupBy\`/\`sort\`) ou \`query\` completa — \`mode: join\` (mescla datasets por chave) ou \`mode: union\` (empilha fontes com colunas mapeadas), com agregações \`count/sum/avg/min/max\`. Fontes da Comunicação: \`whatsapp_conversation\` e \`whatsapp_broadcast\`. Auditado. ${perm('reports', 'CREATE')}`,
    consent: true,
    body: CreateCrmReportSchema,
    responses: {
      201: { description: 'Relatório criado.', schema: WhatsAppReportDTO },
    },
    errors: permErrors('reports', 'CREATE'),
  },
  {
    method: 'get',
    path: REPORT,
    tags: [TAG],
    summary: 'Detalhar relatório',
    description: `Definição do relatório (sem executar — veja \`.../data\`). ${BY_ID_NOTE} ${perm('reports', 'VIEW')}`,
    params: REPORT_PARAMS,
    responses: {
      200: { description: 'Relatório.', schema: WhatsAppReportDTO },
    },
    errors: byIdErrors('reports', 'VIEW', 'CrmReport'),
  },
  {
    method: 'patch',
    path: REPORT,
    tags: [TAG],
    summary: 'Atualizar relatório',
    description: `Atualização parcial (ao menos um campo); \`null\` limpa \`groupBy\`, \`sort\` e \`query\`. ${BY_ID_NOTE} ${UNPARSED_JSON} Auditado. ${perm('reports', 'EDIT')}`,
    consent: true,
    params: REPORT_PARAMS,
    body: UpdateCrmReportSchema,
    responses: {
      200: { description: 'Relatório atualizado.', schema: WhatsAppReportDTO },
    },
    errors: byIdErrors('reports', 'EDIT', 'CrmReport'),
  },
  {
    method: 'delete',
    path: REPORT,
    tags: [TAG],
    summary: 'Excluir relatório',
    description: `${BY_ID_NOTE} Auditado. ${perm('reports', 'DELETE')}`,
    consent: true,
    params: REPORT_PARAMS,
    responses: { 200: { description: 'Relatório excluído.', schema: null } },
    errors: byIdErrors('reports', 'DELETE', 'CrmReport'),
  },
  {
    method: 'get',
    path: `${REPORT}/data`,
    tags: [TAG],
    summary: 'Executar relatório',
    description: `Executa a query do relatório em memória sobre as listagens de cada fonte (com as permissões do usuário em cada uma) e devolve colunas + linhas. Sem paginação. Erros de acesso a uma fonte (ex.: fonte do CRM sem o módulo CRM) são propagados. ${BY_ID_NOTE} ${perm('reports', 'VIEW')}`,
    params: REPORT_PARAMS,
    responses: {
      200: { description: 'Resultado.', schema: WhatsAppReportDataDTO },
    },
    errors: byIdErrors('reports', 'VIEW', 'CrmReport'),
  },
  {
    method: 'get',
    path: `${REPORT}/export`,
    tags: [TAG],
    summary: 'Exportar relatório',
    description: `Executa o relatório e devolve o arquivo para download (fora do envelope JSON): CSV por padrão (\`relatorio.csv\`) ou planilha Excel SpreadsheetML com \`?format=xlsx\` (ou \`excel\`) — \`relatorio.xls\`. Cabeçalhos = rótulos das colunas. Erros seguem o envelope JSON. ${BY_ID_NOTE} ${perm('reports', 'VIEW')}`,
    params: REPORT_PARAMS,
    query: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['csv', 'xlsx', 'excel'],
          default: 'csv',
          description:
            '`xlsx`/`excel` = SpreadsheetML (.xls); outro valor = CSV.',
        },
      },
    },
    responses: {
      200: {
        description: 'Arquivo do relatório.',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string', format: 'binary' },
        headers: {
          'Content-Disposition': {
            description:
              '`attachment; filename="relatorio.csv"` (ou `relatorio.xls` com `format=xlsx`; `Content-Type: application/vnd.ms-excel`).',
          },
        },
      },
    },
    errors: byIdErrors('reports', 'VIEW', 'CrmReport'),
  },
  /* -------------------------------- sources ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/dashboards/sources/{source}',
    tags: [TAG],
    summary: 'Dados de uma fonte dos dashboards',
    description: `Linhas achatadas que os widgets agregam no navegador (contagem, soma, média, baldes de data, período, comparação). Histórico de 400 dias, com teto de 20 mil linhas por fonte. ${perm('dashboards', 'VIEW')}`,
    params: {
      source: {
        description: 'Fonte de dados.',
        schema: { type: 'string', enum: [...WA_DASHBOARD_SOURCES] },
      },
    },
    responses: {
      200: {
        description: 'Linhas.',
        schema: z.array(WhatsAppDashboardRowDTO),
      },
    },
    errors: [
      ...permErrors('dashboards', 'VIEW'),
      {
        code: 'VALIDATION_ERROR',
        message: 'Fonte de dados desconhecida',
        when: '`source` fora da lista',
      },
    ],
  },
]
