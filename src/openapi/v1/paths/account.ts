import type { OpenApiRegistry } from '../../registry'
import { ApiV1MeDTO } from '../schemas'

/** v1 · Conta — `app/api/v1/me`. */
export function registerV1AccountPaths(registry: OpenApiRegistry): void {
  registry.registerRoute({
    method: 'get',
    path: '/me',
    tags: ['v1 · Conta'],
    summary: 'Token em uso',
    operationId: 'getMe',
    description:
      'Dono do token, workspace, papel, escopos, módulos e validade do token (`steel whoami`). Não exige módulo.',
    auth: 'apiToken',
    responses: { 200: { description: 'Token em uso.', schema: ApiV1MeDTO } },
  })
}
