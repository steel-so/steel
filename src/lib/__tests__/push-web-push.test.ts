import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildVapidAuthorization,
  encryptPushPayload,
  MAX_PUSH_PAYLOAD_BYTES,
  sendWebPush,
  type VapidKeys,
} from '../push/web-push'

const b64u = (buffer: Uint8Array) => Buffer.from(buffer).toString('base64url')

function makeVapid(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(pub.x as string, 'base64url'),
    Buffer.from(pub.y as string, 'base64url'),
  ])
  return {
    publicKey: b64u(point),
    privateKey: priv.d as string,
    subject: 'mailto:ti@example.com',
  }
}

function makeClient() {
  const ecdh = createECDH('prime256v1')
  const publicKey = ecdh.generateKeys()
  const authSecret = randomBytes(16)
  return {
    ecdh,
    publicKey,
    authSecret,
    target: { p256dh: b64u(publicKey), auth: b64u(authSecret) },
  }
}

/** Receiver side of RFC 8291, to prove the sender's output is decryptable. */
function decrypt(
  client: ReturnType<typeof makeClient>,
  body: Buffer,
): Buffer {
  const salt = body.subarray(0, 16)
  const idLength = body.readUInt8(20)
  const serverPublic = body.subarray(21, 21 + idLength)
  const encrypted = body.subarray(21 + idLength)
  const shared = client.ecdh.computeSecret(serverPublic)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    client.publicKey,
    serverPublic,
  ])
  const ikm = Buffer.from(
    hkdfSync('sha256', shared, client.authSecret, keyInfo, 32),
  )
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16))
  const plain = Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ])
  expect(plain[plain.length - 1]).toBe(2)
  return plain.subarray(0, plain.length - 1)
}

describe('encryptPushPayload', () => {
  it('should produce an aes128gcm body the client can decrypt', () => {
    const client = makeClient()
    const body = encryptPushPayload(client.target, Buffer.from('olá, Steel'))

    expect(body.readUInt32BE(16)).toBe(4096)
    expect(body.readUInt8(20)).toBe(65)
    expect(decrypt(client, body).toString('utf8')).toBe('olá, Steel')
  })

  it('should accept a fixed salt and key pair', () => {
    const client = makeClient()
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const salt = randomBytes(16)
    const body = encryptPushPayload(client.target, Buffer.from('x'), {
      salt,
      ecdh,
    })

    expect(body.subarray(0, 16).equals(salt)).toBe(true)
    expect(decrypt(client, body).toString()).toBe('x')
  })

  it('should reject payloads above one record', () => {
    const client = makeClient()
    expect(() =>
      encryptPushPayload(
        client.target,
        Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES + 1),
      ),
    ).toThrow('push payload too large')
  })
})

describe('buildVapidAuthorization', () => {
  it('should sign an ES256 JWT for the endpoint origin', () => {
    const vapid = makeVapid()
    const now = new Date('2026-10-30T12:00:00Z')
    const header = buildVapidAuthorization(
      'https://push.example.com/send/abc',
      vapid,
      now,
    )

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, h, c, s, k] = match as RegExpExecArray
    expect(k).toBe(vapid.publicKey)
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims.aud).toBe('https://push.example.com')
    expect(claims.sub).toBe('mailto:ti@example.com')
    expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 12 * 3600)

    const point = Buffer.from(vapid.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64u(point.subarray(1, 33)),
        y: b64u(point.subarray(33, 65)),
      },
      format: 'jwk',
    })
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true)
  })
})

describe('sendWebPush', () => {
  const vapid = makeVapid()

  function target() {
    return { endpoint: 'https://push.example.com/send/abc', ...makeClient().target }
  }

  it('should POST the encrypted body with VAPID and push headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })

    const result = await sendWebPush(
      target(),
      '{"a":1}',
      vapid,
      { urgency: 'high', ttl: 30, topic: 'abc' },
      fetchMock,
    )

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://push.example.com/send/abc')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Encoding']).toBe('aes128gcm')
    expect(init.headers.TTL).toBe('30')
    expect(init.headers.Urgency).toBe('high')
    expect(init.headers.Topic).toBe('abc')
    expect(init.headers.Authorization).toMatch(/^vapid t=/)
  })

  it('should default TTL and urgency and omit the topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })

    await sendWebPush(target(), 'x', vapid, undefined, fetchMock)

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.TTL).toBe('3600')
    expect(headers.Urgency).toBe('normal')
    expect(headers.Topic).toBeUndefined()
  })

  it.each([404, 410])('should flag %s as a gone subscription', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status })

    expect(await sendWebPush(target(), 'x', vapid, {}, fetchMock)).toEqual({
      ok: false,
      gone: true,
      status,
    })
  })

  it('should keep the subscription on other failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    expect(await sendWebPush(target(), 'x', vapid, {}, fetchMock)).toEqual({
      ok: false,
      gone: false,
      status: 500,
    })
  })

  it('should resolve status 0 on network errors and oversized payloads', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await sendWebPush(target(), 'x', vapid, {}, failing)).toEqual({
      ok: false,
      gone: false,
      status: 0,
    })

    const never = vi.fn()
    const big = 'x'.repeat(MAX_PUSH_PAYLOAD_BYTES + 1)
    expect(await sendWebPush(target(), big, vapid, {}, never)).toEqual({
      ok: false,
      gone: false,
      status: 0,
    })
    expect(never).not.toHaveBeenCalled()
  })
})
