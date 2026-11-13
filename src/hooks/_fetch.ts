import {
  type FieldErrors,
  formatFieldErrors,
  readFieldErrors,
} from '@/src/lib/api-field-errors'
import type { SuccessResponse } from '@/types/http-response'

/**
 * Erro de uma chamada à API com o `code` do envelope (`ERROR_CODES`), para a
 * UI tratar casos específicos (`SD_AI_DISABLED`, `AI_QUOTA_EXCEEDED`...).
 * Continua sendo um `Error` com a mensagem do servidor: quem só usa
 * `error.message` (`notify.error`) não muda em nada.
 */
export class ApiError extends Error {
  readonly code: string | null
  readonly status: number
  /** `error.details` of the envelope, when the server sent any. */
  readonly details: unknown
  /** Validation issues by field, when the server sent them. */
  readonly fieldErrors: FieldErrors | null
  /** Seconds to wait before retrying a `RATE_LIMITED` call, when known. */
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    code: string | null,
    status: number,
    details?: unknown,
    extra?: {
      fieldErrors?: FieldErrors | null
      retryAfterSeconds?: number | null
    },
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
    this.fieldErrors = extra?.fieldErrors ?? null
    this.retryAfterSeconds = extra?.retryAfterSeconds ?? null
  }
}

/** Where to send the user when a plan limit blocks the action. */
export function planErrorLink(
  error: unknown,
): { href: string; label: string } | null {
  if (isApiErrorCode(error, 'SEAT_LIMIT_REACHED', 'FEATURE_NOT_IN_PLAN')) {
    return { href: '/upgrade', label: 'Ver planos' }
  }
  return null
}

function waitMessage(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`
}

/** `true` quando o erro veio da API com um destes códigos. */
export function isApiErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && error.code !== null
    ? codes.includes(error.code)
    : false
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null)
  const code: string | null = body?.error?.code ?? null
  const fieldErrors = readFieldErrors(body?.error)
  const headerSeconds = Number(res.headers.get('Retry-After'))
  const detailSeconds = body?.error?.details?.retryAfterSeconds
  const retryAfterSeconds =
    typeof detailSeconds === 'number' && detailSeconds > 0
      ? detailSeconds
      : headerSeconds > 0
        ? headerSeconds
        : null

  let message: string = body?.message ?? fallback
  if (code === 'VALIDATION_ERROR' && fieldErrors) {
    message = formatFieldErrors(fieldErrors)
  } else if (code === 'RATE_LIMITED' && retryAfterSeconds) {
    message = `Muitas tentativas. Tente de novo em ${waitMessage(retryAfterSeconds)}.`
  }
  throw new ApiError(message, code, res.status, body?.error?.details, {
    fieldErrors,
    retryAfterSeconds,
  })
}

// Fetches and return the `data` payload, throwing `ApiError(message)` on failure
export async function apiFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackError = 'Algo deu errado',
): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) await throwApiError(res, fallbackError)
  const json: SuccessResponse<T> = await res.json()
  return json.data
}

// Loike `apiFetch`, but for endpoints whose success body is not needed
export async function apiSend(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackError = 'Algo deu errado',
): Promise<void> {
  const res = await fetch(input, init)
  if (!res.ok) await throwApiError(res, fallbackError)
}

// `apiFetch` with a JSON body (POST/PATCH/PUT)
export async function apiFetchJson<T>(
  input: RequestInfo | URL,
  method: string,
  body?: unknown,
  fallbackError = 'Algo deu errado',
): Promise<T> {
  return apiFetch<T>(
    input,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    fallbackError,
  )
}
