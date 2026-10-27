import {
  WorkspaceAccessLogExportQuerySchema,
  WorkspaceAccessLogListQuerySchema,
} from '@/src/schemas/workspace-access-log.schema'
import { PLATFORM_ADMIN_ERRORS, WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import { WorkspaceAccessLogListDTO } from '../schemas/workspace-access-log'

/**
 * Registro de acessos de workspaces com allowlist de IPs (ADR 0053):
 * Ajustes › Segurança (`/workspaces/{id}/access-logs/**`) e o painel do
 * admin global (`/admin/workspaces/{id}/access-logs/**`).
 */

const WORKSPACE_TAG = 'Configurações do workspace' as const
const ADMIN_TAG = 'Admin · Workspaces' as const

const ABOUT =
  'Cada tentativa de entrada num workspace **com** allowlist de IPs — permitida ou bloqueada, no app ou na API — com usuário (nome e e-mail gravados na hora), IP, navegador e caminho. Sem allowlist nada é registrado. Entradas repetidas da mesma pessoa, rede, resultado e canal contam uma vez a cada 30 min (permitidas) ou a cada minuto (bloqueadas). Guardado por 5 anos. Dias civis em `America/Sao_Paulo`; sem `from`/`to`, os últimos 30 dias.'

const CSV =
  "CSV em UTF-8 com BOM, transmitido em partes, em ordem cronológica, com cabeçalho em português (`Data e hora (São Paulo), Resultado, Canal, Nome, E-mail, ID do usuário, IP, Caminho, Navegador (user agent)`). Até 100.000 linhas por arquivo: acima disso responde `VALIDATION_ERROR` com `details.total` e `details.max` (reduza o período ou filtre). Células que começam com `=`, `+`, `-` ou `@` ganham `'`. Auditado (IP é dado pessoal)."

// Same entry as the other admin workspace routes (shared component).
const WORKSPACE_NOT_FOUND: ErrorEntry = {
  code: 'RESOURCE_NOT_FOUND',
  message: 'Workspace not found',
  when: 'Workspace inexistente',
}

const csvResponse = {
  200: {
    description: 'Arquivo CSV (`Content-Disposition: attachment`).',
    envelope: false,
    contentType: 'text/csv',
    schema: { type: 'string' },
  },
} as const

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/access-logs',
    tags: [WORKSPACE_TAG],
    summary: 'Registro de acessos (rede permitida)',
    description: `${ABOUT} Também devolve a allowlist atual (só leitura; quem a define é o admin global). Só OWNER/ADMIN.`,
    query: WorkspaceAccessLogListQuerySchema,
    responses: {
      200: { description: 'Entradas.', schema: WorkspaceAccessLogListDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'WORKSPACE_IP_NOT_ALLOWED',
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/access-logs/export',
    tags: [WORKSPACE_TAG],
    summary: 'Exportar registro de acessos (CSV)',
    description: `${CSV} Só OWNER/ADMIN.`,
    query: WorkspaceAccessLogExportQuerySchema,
    responses: csvResponse,
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'WORKSPACE_IP_NOT_ALLOWED',
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/admin/workspaces/{id}/access-logs',
    tags: [ADMIN_TAG],
    summary: 'Registro de acessos do workspace',
    description: `${ABOUT}\n\nSó admin global da plataforma.`,
    query: WorkspaceAccessLogListQuerySchema,
    responses: {
      200: { description: 'Entradas.', schema: WorkspaceAccessLogListDTO },
    },
    errors: [...PLATFORM_ADMIN_ERRORS, WORKSPACE_NOT_FOUND, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: '/admin/workspaces/{id}/access-logs/export',
    tags: [ADMIN_TAG],
    summary: 'Exportar registro de acessos do workspace (CSV)',
    description: `${CSV}\n\nSó admin global da plataforma.`,
    query: WorkspaceAccessLogExportQuerySchema,
    responses: csvResponse,
    errors: [...PLATFORM_ADMIN_ERRORS, WORKSPACE_NOT_FOUND, 'VALIDATION_ERROR'],
  },
]

export function registerWorkspaceAccessLogPaths(
  registry: OpenApiRegistry,
): void {
  for (const route of routes) registry.registerRoute(route)
}
