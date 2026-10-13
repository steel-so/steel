import 'server-only'

import { logger } from '@/lib/axiom/logger'
import {
  PABX_CALL_AUDIO,
  PABX_CALL_TOKEN,
  PABX_CALL_URL,
} from '@/lib/env/server'
import type { AppError } from '@/src/errors/app-error'
import { pabxCallFailed, pabxNotConfigured } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

/** `DIRECT` rings the destination right away; `RECORDING` plays the greeting first. */
export type PabxCallMode = 'DIRECT' | 'RECORDING'

const CALL_TYPE: Record<PabxCallMode, '1' | '2'> = {
  DIRECT: '1',
  RECORDING: '2',
}

const TIMEOUT_MS = 10_000

export interface PabxCallInput {
  deviceId: string
  extension: string
  /** Any phone format; normalized by {@link toPabxDestination}. */
  destination: string
  mode: PabxCallMode
}

/**
 * The dialer expects the national number (area code + subscriber), the same
 * way an extension dials out. WhatsApp ids carry the Brazilian country code,
 * so `55` is dropped from 12/13-digit numbers; anything else is sent as is.
 */
export function toPabxDestination(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
    return digits.slice(2)
  return digits
}

/** Asks the PABX to ring the extension and bridge it to the destination. */
export async function placePabxCall(
  input: PabxCallInput,
): Promise<Result<{ destination: string }, AppError>> {
  if (!PABX_CALL_URL || !PABX_CALL_TOKEN) return err(pabxNotConfigured())

  const destination = toPabxDestination(input.destination)
  const body = new URLSearchParams({
    iddevice: input.deviceId,
    ramal: input.extension,
    destino: destination,
    tipo: CALL_TYPE[input.mode],
    audio: PABX_CALL_AUDIO,
    token: PABX_CALL_TOKEN,
  })

  let response: Response
  try {
    response = await fetch(PABX_CALL_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    logger.error('pabx call request failed', {
      deviceId: input.deviceId,
      extension: input.extension,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(pabxCallFailed('O PABX não respondeu. Tente novamente.'))
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    mensagem?: string
  } | null

  if (!response.ok || payload?.ok !== true) {
    logger.warn('pabx call refused', {
      deviceId: input.deviceId,
      extension: input.extension,
      status: response.status,
      message: payload?.mensagem,
    })
    return err(
      pabxCallFailed(
        payload?.mensagem
          ? `O PABX recusou a ligação: ${payload.mensagem}`
          : undefined,
      ),
    )
  }

  return ok({ destination })
}
