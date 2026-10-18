import * as appErrors from '@/src/errors/app-error'
import { ERROR_CODES, type ErrorCode } from '@/src/errors/codes'
import type { JsonSchema } from './json-schema'

/**
 * Catálogo de erros da documentação, derivado de `src/errors/codes.ts`
 * (código → status HTTP) — nunca duplicado à mão.
 */

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[]

export function statusOf(code: ErrorCode): number {
  return ERROR_CODES[code].status
}

/**
 * Mensagem padrão de cada código, lida das fábricas de `app-error.ts` que
 * não exigem argumento (`forbidden()`, `crmFormNotFound()`...). Ordem
 * alfabética das fábricas → resultado determinístico quando duas fábricas
 * produzem o mesmo código.
 */
const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = (() => {
  const messages: Partial<Record<ErrorCode, string>> = {
    RESOURCE_NOT_FOUND: 'Recurso não encontrado',
    VALIDATION_ERROR: 'Dados inválidos',
    RATE_LIMITED: 'Muitas requisições',
  }
  const factories = Object.entries(appErrors)
    .filter(
      (entry): entry is [string, () => appErrors.AppError] =>
        typeof entry[1] === 'function' && entry[1].length === 0,
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  for (const [, factory] of factories) {
    const error = factory()
    if (!error || typeof error.code !== 'string') continue
    if (!(error.code in ERROR_CODES)) continue
    messages[error.code] ??= error.message
  }
  return messages
})()

export function defaultMessage(code: ErrorCode): string | undefined {
  return DEFAULT_MESSAGES[code]
}

/** Título curto de cada status HTTP de erro (pt-BR). */
export const STATUS_TITLES: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  402: 'Cota esgotada',
  403: 'Acesso negado',
  404: 'Não encontrado',
  409: 'Conflito com o estado atual',
  410: 'Expirado',
  422: 'Dados inválidos',
  428: 'Aguardando confirmação',
  429: 'Limite de requisições excedido',
  500: 'Erro interno',
  502: 'Falha em serviço externo',
  503: 'Serviço indisponível',
}

/** Detalhes de exemplo — o formato real de `details` varia por código. */
const EXAMPLE_DETAILS: Partial<Record<ErrorCode, unknown>> = {
  VALIDATION_ERROR: [
    {
      code: 'too_small',
      path: ['name'],
      message: 'Nome deve ter ao menos 2 caracteres',
    },
  ],
  RATE_LIMITED: { retryAfterSeconds: 30 },
}

export function errorExample(
  code: ErrorCode,
  message: string | undefined = defaultMessage(code),
): JsonSchema {
  // Detalhes de exemplo só no caso genérico (ex.: issues do Zod na
  // validação de corpo); mensagens específicas não trazem `details`.
  const details =
    code === 'RATE_LIMITED' || message === defaultMessage(code)
      ? EXAMPLE_DETAILS[code]
      : undefined
  return {
    success: false,
    statusCode: statusOf(code),
    ...(message !== undefined && { message }),
    error: {
      code,
      ...(details !== undefined && { details }),
    },
  }
}

/** Schema `ErrorCode`: enum + tabela código → status na descrição. */
export function errorCodeSchema(): JsonSchema {
  const rows = ERROR_CODE_LIST.map(
    (code) => `| \`${code}\` | ${statusOf(code)} |`,
  )
  return {
    type: 'string',
    enum: ERROR_CODE_LIST,
    description: [
      'Código estável do erro (fonte: `src/errors/codes.ts`). Use o código — não a mensagem — para tratar erros no cliente.',
      '',
      '| Código | Status HTTP |',
      '| ------ | ----------- |',
      ...rows,
    ].join('\n'),
  }
}
