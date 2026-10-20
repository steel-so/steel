import 'server-only'

import { logger } from '@/lib/axiom/logger'
import { PABX_WEBPHONE_ENDPOINT_TEMPLATE } from '@/lib/env/server'
import type { AppError } from '@/src/errors/app-error'
import { pabxCallFailed, pabxDeviceNotFound } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import type { WebphoneCredentialsDTO } from '@/types/pabx-webphone'
import { findPabxDevice } from './device-directory'

const TIMEOUT_MS = 10_000

/** Public STUN so the browser can reach the PABX media through its NAT. */
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }]

/**
 * Asks the device's own PABX for the extension's browser (WebRTC) credentials.
 * The PABX only answers for extensions configured for WSS + DTLS-SRTP, and the
 * request is authenticated by the device token read from `steel.device`.
 */
export async function provisionWebphone(
  deviceId: string,
  extension: string,
): Promise<Result<WebphoneCredentialsDTO, AppError>> {
  const device = await findPabxDevice(deviceId)
  if (!device.ok) return device
  if (!device.value) return err(pabxDeviceNotFound())

  const url = PABX_WEBPHONE_ENDPOINT_TEMPLATE.replace(
    '{host}',
    device.value.host,
  )

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({
        iddevice: deviceId,
        ramal: extension,
        token: device.value.token,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    logger.error('pabx webphone provisioning request failed', {
      deviceId,
      extension,
      host: device.value.host,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(pabxCallFailed('O PABX não respondeu. Tente novamente.'))
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    mensagem?: string
    secret?: string
    domain?: string
    wss?: string
  } | null

  if (
    !response.ok ||
    payload?.ok !== true ||
    !payload.secret ||
    !payload.domain ||
    !payload.wss
  ) {
    logger.warn('pabx webphone provisioning refused', {
      deviceId,
      extension,
      host: device.value.host,
      status: response.status,
      message: payload?.mensagem,
    })
    return err(
      pabxCallFailed(
        payload?.mensagem
          ? `O PABX recusou o telefone web: ${payload.mensagem}`
          : 'Não foi possível preparar o telefone web.',
      ),
    )
  }

  return ok({
    extension,
    password: payload.secret,
    domain: payload.domain,
    wssUrl: payload.wss,
    iceServers: ICE_SERVERS,
  })
}
