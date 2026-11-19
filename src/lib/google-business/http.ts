import { logger } from '@/lib/axiom/logger'
import {
  crmGoogleApiFailed,
  crmSocialScopeMissing,
  crmSocialTokenExpired,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

type GoogleErrorBody = {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { reason?: string }[]
  }
}

function parseBody(bodyText: string): GoogleErrorBody {
  try {
    return JSON.parse(bodyText) as GoogleErrorBody
  } catch {
    return {}
  }
}

/**
 * Maps a failed Google API answer to an `AppError` with a pt-BR message the
 * user can act on. Pure — the status and the body are all it needs.
 */
export function mapGoogleFailure(status: number, bodyText: string): AppError {
  const { error } = parseBody(bodyText)
  const message = error?.message ?? ''
  const reasons = (error?.details ?? []).map((d) => d.reason ?? '')

  if (status === 401) return crmSocialTokenExpired()

  if (status === 403) {
    if (/insufficient authentication scopes/i.test(message)) {
      return crmSocialScopeMissing()
    }
    if (
      reasons.includes('SERVICE_DISABLED') ||
      /has not been used|is disabled|not been enabled/i.test(message)
    ) {
      return crmGoogleApiFailed(
        'A API do Google Meu Negócio ainda não está liberada para o aplicativo do Steel (depende de aprovação do Google). Fale com o suporte da Stratus.',
      )
    }
    if (error?.status === 'RESOURCE_EXHAUSTED' || /quota/i.test(message)) {
      return crmGoogleApiFailed(
        'O Google limitou as consultas deste aplicativo. Tente novamente em alguns minutos.',
      )
    }
    return crmGoogleApiFailed(
      'O Google negou o acesso. Confira se a conta conectada é proprietária ou gerente deste local.',
    )
  }

  if (status === 429) {
    return crmGoogleApiFailed(
      'O Google limitou as consultas. Tente novamente em alguns minutos.',
    )
  }
  if (status === 404) {
    return crmGoogleApiFailed('O Google não encontrou este item.')
  }
  if (status === 400) {
    return crmGoogleApiFailed(
      message
        ? `O Google recusou os dados enviados: ${message.slice(0, 200)}`
        : 'O Google recusou os dados enviados.',
    )
  }
  return crmGoogleApiFailed()
}

export type GoogleRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  accessToken: string
  query?: Record<string, string | number | string[] | undefined>
  body?: unknown
}

function withQuery(url: string, query: GoogleRequest['query']): string {
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) params.append(key, item)
    else params.append(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

/** One authenticated call to a Google REST API; the body is parsed JSON. */
export async function googleRequest<T>(
  request: GoogleRequest,
): Promise<Result<T>> {
  const url = withQuery(request.url, request.query)
  try {
    const response = await fetch(url, {
      method: request.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
        Accept: 'application/json',
        ...(request.body !== undefined && {
          'Content-Type': 'application/json',
        }),
      },
      ...(request.body !== undefined && {
        body: JSON.stringify(request.body),
      }),
    })
    const bodyText = await response.text().catch(() => '')
    if (!response.ok) {
      logger.warn('google_business.request_failed', {
        component: 'GoogleBusinessHttp',
        method: request.method ?? 'GET',
        url: request.url,
        status: response.status,
        body: bodyText.slice(0, 300),
      })
      return err(mapGoogleFailure(response.status, bodyText))
    }
    return ok((bodyText ? JSON.parse(bodyText) : {}) as T)
  } catch (error) {
    logger.error('google_business.request_error', {
      component: 'GoogleBusinessHttp',
      url: request.url,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(crmGoogleApiFailed())
  }
}
