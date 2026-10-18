import { ERROR_CODES } from '@/src/errors/codes'
import type { ErrorEntry, ErrorSpec, OpenApiRegistry } from '../../registry'
import {
  DeviceAuthorizationDTO,
  DeviceAuthorizationRequestDTO,
  DeviceTokenDTO,
  DeviceTokenPollDTO,
} from '../schemas'

/**
 * v1 · Autenticação — the device flow of `steel login` and `steel logout`
 * (`app/api/v1/auth/**`, implemented by the api-tokens slice). Documented
 * here so the SDK generated from `openapi.v1.json` covers the login.
 */

const TAG = 'v1 · Autenticação' as const

/**
 * The device-flow codes are registered by the api-tokens slice; until it
 * lands they are left out instead of failing the generator.
 */
function known(entries: ErrorSpec[]): ErrorEntry[] {
  return entries.filter((entry) => entry.code in ERROR_CODES)
}

export function registerV1AuthPaths(registry: OpenApiRegistry): void {
  registry.registerRoute({
    method: 'post',
    path: '/auth/device',
    tags: [TAG],
    summary: 'Iniciar login do CLI',
    operationId: 'startDeviceAuthorization',
    description:
      'Usado por `steel login` (fluxo de dispositivo). Cria um login pendente: o CLI mostra `userCode` e abre `verificationUriComplete`; o usuário confirma em `/device`, escolhendo workspace, módulos e escopo. Sem token. O código vale 10 minutos.',
    auth: 'public',
    rateLimit: 'ip',
    body: { schema: DeviceAuthorizationRequestDTO, required: false },
    responses: {
      200: { description: 'Login pendente.', schema: DeviceAuthorizationDTO },
    },
  })

  registry.registerRoute({
    method: 'post',
    path: '/auth/device/token',
    tags: [TAG],
    summary: 'Consultar login do CLI',
    operationId: 'pollDeviceToken',
    description:
      'O CLI consulta a cada `interval` segundos até o usuário responder. Aprovado, devolve o token pessoal (uma vez só), chamado "Steel CLI — <máquina>". Pendente: `428 AUTHORIZATION_PENDING`; rápido demais: `429 SLOW_DOWN` (novo intervalo em `error.details.interval`); vencido ou já usado: `410 EXPIRED_TOKEN`; recusado: `403 ACCESS_DENIED`.',
    auth: 'public',
    rateLimit: 'ip',
    body: DeviceTokenPollDTO,
    responses: {
      200: { description: 'Login aprovado: o token.', schema: DeviceTokenDTO },
    },
    errors: [
      ...known([
        {
          code: 'AUTHORIZATION_PENDING' as never,
          when: 'O usuário ainda não respondeu',
        },
        { code: 'SLOW_DOWN' as never, when: 'Consulta antes do intervalo' },
        {
          code: 'EXPIRED_TOKEN' as never,
          when: 'Código vencido, desconhecido ou já usado',
        },
        { code: 'ACCESS_DENIED' as never, when: 'O usuário recusou o login' },
        {
          code: 'API_TOKEN_LIMIT_REACHED' as never,
          when: 'O usuário já tem 50 tokens ativos',
        },
      ]),
      { code: 'FORBIDDEN', when: 'O usuário perdeu o acesso ao workspace' },
      'MODULE_DISABLED',
    ],
  })

  registry.registerRoute({
    method: 'delete',
    path: '/auth/token',
    tags: [TAG],
    summary: 'Revogar o token em uso',
    operationId: 'revokeCurrentToken',
    description:
      'Usado por `steel logout`: revoga o token desta chamada. As chamadas seguintes com ele respondem 401.',
    auth: 'apiToken',
    responses: {
      204: { description: 'Token revogado; sem corpo.', envelope: false },
    },
  })
}
