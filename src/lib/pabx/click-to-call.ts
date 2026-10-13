import 'server-only'

import { logger } from '@/lib/axiom/logger'
import { PABX_ENDPOINT_TEMPLATE } from '@/lib/env/server'
import type { AppError } from '@/src/errors/app-error'
import { pabxCallFailed, pabxDeviceNotFound } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { findPabxDevice } from './device-directory'

const TIMEOUT_MS = 10_000

export interface PabxCallInput {
  deviceId: string
  extension: string
  /** Any phone format; normalized by {@link toPabxDestination}. */
  destination: string
  /** Webhook the PABX dialplan reports the call status to. */
  callbackUrl: string
  /** Per-call secret echoed back by the dialplan on every report. */
  callbackToken: string
}

export interface PabxCallQueued {
  destination: string
  /** Call-file job id on the PABX. */
  job: string | null
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

/**
 * Asks the device's PABX to ring the extension and bridge it to the
 * destination (`tipo=1`, straight to the call). Each device is its own PABX:
 * the address and token come from `steel.device`.
 */
export async function placePabxCall(
  input: PabxCallInput,
): Promise<Result<PabxCallQueued, AppError>> {
  const device = await findPabxDevice(input.deviceId)
  if (!device.ok) return device
  if (!device.value) return err(pabxDeviceNotFound())

  const url = PABX_ENDPOINT_TEMPLATE.replace('{host}', device.value.host)
  const destination = toPabxDestination(input.destination)
  const body = new URLSearchParams({
    iddevice: input.deviceId,
    ramal: input.extension,
    destino: destination,
    tipo: '1',
    token: device.value.token,
    callback_url: input.callbackUrl,
    callback_token: input.callbackToken,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    logger.error('pabx call request failed', {
      deviceId: input.deviceId,
      extension: input.extension,
      host: device.value.host,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(pabxCallFailed('O PABX não respondeu. Tente novamente.'))
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    mensagem?: string
    job?: string
  } | null

  if (!response.ok || payload?.ok !== true) {
    logger.warn('pabx call refused', {
      deviceId: input.deviceId,
      extension: input.extension,
      host: device.value.host,
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

  return ok({ destination, job: payload.job ?? null })
}
