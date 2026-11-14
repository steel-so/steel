import { NextResponse } from 'next/server'
import { ERROR_CODES } from '@/src/errors/codes'
import { annotateRequest } from '@/src/lib/analytics/request-context'
import { fieldErrorsFromIssues } from '@/src/lib/api-field-errors'
import type { AppError } from '@/src/errors/app-error'
import type { ErrorCode } from '@/src/errors/codes'
import type { FieldErrors } from '@/src/lib/api-field-errors'
import type { ErrorResponse, SuccessResponse } from '@/types/http-response'
import '@/src/lib/zod-locale'

export type { ErrorCode }

export interface CacheOptions {
  maxAge?: number
  staleWhileRevalidate?: number
  private?: boolean
}

export function successResponse<T>(
  data: T,
  statusCode: number = 200,
  message?: string,
  cacheOptions?: CacheOptions,
): NextResponse<SuccessResponse<T>> {
  const response: SuccessResponse<T> = {
    success: true,
    statusCode,
    data,
  }

  if (message) response.message = message

  const headers: HeadersInit = {}

  if (cacheOptions) {
    const { maxAge = 0, staleWhileRevalidate = 0, private: isPrivate = false } = cacheOptions
    const scope = isPrivate ? 'private' : 'public'
    headers['Cache-Control'] = `${scope}, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
  }

  return NextResponse.json(response, { status: statusCode, headers })
}

export const DATABASE_ERROR_MESSAGE = 'Erro interno. Tente novamente.'

export type ErrorDetails = Record<string, unknown> | unknown[]

export function errorResponse(
  code: string,
  statusCode: number = 500,
  message?: string,
  details?: ErrorDetails,
): NextResponse<ErrorResponse> {
  // Erro de domínio no log da requisição (painel Analytics → Erros); a
  // mensagem é limpa/truncada no log, e é no-op fora de um `withAxiom`.
  annotateRequest({ errorCode: code, errorMessage: message })

  // Validation issues also come flattened by field (`error.fieldErrors`) so
  // the UI can say "campo: motivo" without parsing Zod.
  const fieldErrors: FieldErrors | null =
    code === 'VALIDATION_ERROR' ? fieldErrorsFromIssues(details) : null

  const response: ErrorResponse = {
    success: false,
    statusCode,
    error: {
      code,
      ...(details && { details }),
      ...(fieldErrors && { fieldErrors }),
    },
  }

  if (message) {
    response.message = message
  }

  return NextResponse.json(response, { status: statusCode })
}

export function standardError(
  errorType: ErrorCode,
  message?: string,
  details?: ErrorDetails,
): NextResponse<ErrorResponse> {
  const { code, status } = ERROR_CODES[errorType]
  return errorResponse(code, status, message, details)
}

export function handleError(error: AppError): NextResponse<ErrorResponse> {
  const { status } = ERROR_CODES[error.code]
  const details = error.details as ErrorDetails | undefined
  // Repositories describe database failures in English; the user gets a
  // generic pt-BR message and the detail stays in the request log.
  const isDatabaseError = error.code === 'DATABASE_ERROR'
  const response = errorResponse(
    error.code,
    status,
    isDatabaseError ? DATABASE_ERROR_MESSAGE : error.message,
    isDatabaseError ? undefined : details,
  )
  if (isDatabaseError) {
    annotateRequest({ errorCode: error.code, errorMessage: error.message })
  }

  if (error.code === 'RATE_LIMITED') {
    const seconds = (error.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds
    if (typeof seconds === 'number' && seconds > 0) {
      response.headers.set('Retry-After', String(seconds))
    }
  }

  return response
}
