import type { ErrorEntry } from '../../registry'

/**
 * Pieces shared by the v1 registrations. Every v1 route authenticates with
 * a personal token (`auth: 'apiToken'` adds the 401 and the 429 of the
 * per-token limit) and runs as the token's owner: the RBAC and module
 * errors are the app's.
 */

export const V1_READ =
  'Escopo `api:read` (todo token tem). Roda com as permissões do dono do token.'
export const V1_WRITE =
  'Escopo **`api:write`**. Roda com as permissões do dono do token. Auditado com `source: api`.'

/** Module the token was not created for. */
export function moduleErrors(module: string): ErrorEntry[] {
  return [
    {
      code: 'API_TOKEN_MODULE_NOT_ALLOWED',
      when: `O token não inclui o módulo ${module}`,
    },
    {
      code: 'FORBIDDEN',
      when: 'O dono do token não tem a permissão no workspace',
    },
    'WORKSPACE_SUSPENDED',
    { code: 'MODULE_DISABLED', when: `Módulo ${module} desabilitado` },
  ]
}

export const WRITE_ERRORS: ErrorEntry[] = [
  { code: 'API_TOKEN_SCOPE_REQUIRED', when: 'Token sem o escopo api:write' },
]

export const PAGINATION_NOTE =
  'Paginação por cursor: `limit` (padrão 25, máximo 100) e `cursor` (o `nextCursor` da página anterior).'
