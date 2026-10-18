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

  constructor(
    message: string,
    code: string | null,
    status: number,
    details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** `true` quando o erro veio da API com um destes códigos. */
export function isApiErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && error.code !== null
    ? codes.includes(error.code)
    : false
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null)
  throw new ApiError(
    body?.message ?? fallback,
    body?.error?.code ?? null,
    res.status,
    body?.error?.details,
  )
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
