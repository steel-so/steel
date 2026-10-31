import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'

/**
 * Minimal Web Push sender (RFC 8030 + RFC 8291 `aes128gcm` + RFC 8292 VAPID)
 * on top of `node:crypto`, so the feature needs no extra dependency. Pure: no
 * env, no database; the caller passes the VAPID keys.
 */

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string
  /** base64url, 32-byte scalar. */
  privateKey: string
  /** `mailto:` or https URL of the sender's contact. */
  subject: string
}

export interface PushTarget {
  endpoint: string
  /** base64url, 65-byte client public key. */
  p256dh: string
  /** base64url, 16-byte client auth secret. */
  auth: string
}

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface PushSendOptions {
  /** Seconds the push service may hold the message. */
  ttl?: number
  urgency?: PushUrgency
  /** Collapse key: a newer message with the same topic replaces the older. */
  topic?: string
}

export type PushSendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status: number }

const RECORD_SIZE = 4096
/** Plaintext limit of one record: size - 16 (tag) - 1 (delimiter) - header. */
export const MAX_PUSH_PAYLOAD_BYTES = 3993

const b64u = (buffer: Uint8Array): string =>
  Buffer.from(buffer).toString('base64url')

const fromB64u = (value: string): Buffer => Buffer.from(value, 'base64url')

/** VAPID JWT (ES256) for the push service origin of `endpoint`. */
export function buildVapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  now: Date = new Date(),
): string {
  const audience = new URL(endpoint).origin
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  )
  const point = fromB64u(vapid.publicKey)
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: b64u(point.subarray(1, 33)),
      y: b64u(point.subarray(33, 65)),
    },
    format: 'jwk',
  })
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`
}

/** RFC 8291 encryption of `payload` for one subscription (single record). */
export function encryptPushPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: Buffer,
  random: { salt?: Buffer; ecdh?: ReturnType<typeof createECDH> } = {},
): Buffer {
  if (payload.length > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error('push payload too large')
  }
  const clientPublic = fromB64u(target.p256dh)
  const authSecret = fromB64u(target.auth)
  const ecdh = random.ecdh ?? createECDH('prime256v1')
  const serverPublic = random.ecdh ? ecdh.getPublicKey() : ecdh.generateKeys()
  const shared = ecdh.computeSecret(clientPublic)
  const salt = random.salt ?? randomBytes(16)

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    clientPublic,
    serverPublic,
  ])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(21 + serverPublic.length)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(serverPublic.length, 20)
  serverPublic.copy(header, 21)
  return Buffer.concat([header, encrypted])
}

/**
 * Sends one push. A 404/410 answer means the subscription is gone and the
 * caller should delete it. Network failures resolve to `status: 0`.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  vapid: VapidKeys,
  options: PushSendOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<PushSendResult> {
  const headers: Record<string, string> = {
    Authorization: buildVapidAuthorization(target.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttl ?? 60 * 60),
    Urgency: options.urgency ?? 'normal',
  }
  if (options.topic) headers.Topic = options.topic

  try {
    const body = encryptPushPayload(target, Buffer.from(payload, 'utf8'))
    const response = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return { ok: true }
    return {
      ok: false,
      gone: response.status === 404 || response.status === 410,
      status: response.status,
    }
  } catch {
    return { ok: false, gone: false, status: 0 }
  }
}
