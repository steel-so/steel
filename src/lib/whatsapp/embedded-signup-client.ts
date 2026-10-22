/**
 * Browser helpers for the WhatsApp Embedded Signup (Facebook JS SDK).
 * Pure functions are exported for unit tests; the SDK loader touches `window`.
 */

export const META_GRAPH_VERSION = 'v26.0'

export type EmbeddedSignupMessage =
  | { kind: 'finish'; phoneNumberId: string; wabaId: string }
  | { kind: 'cancel' }
  | { kind: 'error'; message: string }

/**
 * Parses a `window` message event from facebook.com. Returns null for
 * anything that is not a WA_EMBEDDED_SIGNUP payload from a Facebook origin.
 */
export function parseEmbeddedSignupMessage(event: {
  origin: string
  data: unknown
}): EmbeddedSignupMessage | null {
  if (!/^https:\/\/(www|web)\.facebook\.com$/.test(event.origin)) return null
  let data: unknown = event.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object') return null
  const payload = data as {
    type?: string
    event?: string
    data?: {
      phone_number_id?: string
      waba_id?: string
      error_message?: string
    }
  }
  if (payload.type !== 'WA_EMBEDDED_SIGNUP') return null
  if (payload.event === 'CANCEL') return { kind: 'cancel' }
  if (payload.event === 'ERROR') {
    return {
      kind: 'error',
      message:
        payload.data?.error_message ??
        'A Meta não conseguiu concluir o cadastro',
    }
  }
  if (payload.event === 'FINISH') {
    const phoneNumberId = payload.data?.phone_number_id
    const wabaId = payload.data?.waba_id
    if (!phoneNumberId || !wabaId) {
      return {
        kind: 'error',
        message: 'A Meta não informou o número escolhido',
      }
    }
    return { kind: 'finish', phoneNumberId, wabaId }
  }
  return null
}

interface FacebookSdk {
  init: (options: Record<string, unknown>) => void
  login: (
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ) => void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

let sdkPromise: Promise<FacebookSdk> | null = null

/** Loads the Facebook JS SDK once. */
export function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      const fb = window.FB
      if (!fb) return reject(new Error('sdk'))
      fb.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: META_GRAPH_VERSION,
      })
      resolve(fb)
    }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      sdkPromise = null
      reject(new Error('sdk'))
    }
    document.body.appendChild(script)
  })
  return sdkPromise
}

/**
 * Opens the Embedded Signup popup. Resolves with the OAuth `code` and the
 * ids picked by the customer once both the login callback and the FINISH
 * message have arrived.
 */
export async function launchEmbeddedSignup(options: {
  appId: string
  configId: string
}): Promise<
  | { ok: true; code: string; phoneNumberId: string; wabaId: string }
  | { ok: false; reason: 'cancel' | 'error'; message: string }
> {
  let fb: FacebookSdk
  try {
    fb = await loadFacebookSdk(options.appId)
  } catch {
    return {
      ok: false,
      reason: 'error',
      message:
        'Não foi possível carregar o login da Meta. Verifique bloqueadores e tente de novo.',
    }
  }

  return new Promise((resolve) => {
    let code: string | null = null
    let ids: { phoneNumberId: string; wabaId: string } | null = null
    let done = false

    const finish = (
      value:
        | { ok: true; code: string; phoneNumberId: string; wabaId: string }
        | { ok: false; reason: 'cancel' | 'error'; message: string },
    ) => {
      if (done) return
      done = true
      window.removeEventListener('message', onMessage)
      resolve(value)
    }
    const tryComplete = () => {
      if (code && ids) finish({ ok: true, code, ...ids })
    }
    const onMessage = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupMessage(event)
      if (!parsed) return
      if (parsed.kind === 'finish') {
        ids = { phoneNumberId: parsed.phoneNumberId, wabaId: parsed.wabaId }
        tryComplete()
      } else if (parsed.kind === 'cancel') {
        finish({
          ok: false,
          reason: 'cancel',
          message: 'Cadastro cancelado na Meta.',
        })
      } else {
        finish({ ok: false, reason: 'error', message: parsed.message })
      }
    }
    window.addEventListener('message', onMessage)

    fb.login(
      (response) => {
        const received = response.authResponse?.code
        if (!received) {
          finish({
            ok: false,
            reason: 'cancel',
            message: 'Login com a Meta não concluído.',
          })
          return
        }
        code = received
        tryComplete()
      },
      {
        config_id: options.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      },
    )
  })
}
