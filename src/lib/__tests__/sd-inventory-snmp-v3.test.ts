import { describe, expect, it, vi } from 'vitest'

const sessions = vi.hoisted(() => ({
  v2: vi.fn(),
  v3: vi.fn(),
}))

vi.mock('net-snmp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net-snmp')>()
  const fake = () => ({
    on: vi.fn(),
    close: vi.fn(),
    get: vi.fn(),
    subtree: vi.fn(),
  })
  return {
    ...actual,
    createSession: (...args: unknown[]) => {
      sessions.v2(...args)
      return fake()
    },
    createV3Session: (...args: unknown[]) => {
      sessions.v3(...args)
      return fake()
    },
  }
})

import { AuthProtocols, PrivProtocols, SecurityLevel } from 'net-snmp'
import { buildSnmpV3User, createNetSnmpSession } from '../servicedesk/snmp'

describe('buildSnmpV3User', () => {
  it('uses noAuthNoPriv without keys', () => {
    expect(buildSnmpV3User({ username: 'u' })).toEqual({
      name: 'u',
      level: SecurityLevel.noAuthNoPriv,
    })
  })

  it('uses authNoPriv with only the authentication key (SHA by default)', () => {
    expect(
      buildSnmpV3User({ username: 'u', authKey: 'auth-secret-1' }),
    ).toEqual({
      name: 'u',
      level: SecurityLevel.authNoPriv,
      authProtocol: AuthProtocols.sha,
      authKey: 'auth-secret-1',
    })
  })

  it('uses authPriv with both keys and maps every protocol', () => {
    const auth = {
      MD5: AuthProtocols.md5,
      SHA: AuthProtocols.sha,
      SHA224: AuthProtocols.sha224,
      SHA256: AuthProtocols.sha256,
      SHA384: AuthProtocols.sha384,
      SHA512: AuthProtocols.sha512,
    } as const
    const priv = {
      DES: PrivProtocols.des,
      AES: PrivProtocols.aes,
      AES256B: PrivProtocols.aes256b,
      AES256R: PrivProtocols.aes256r,
    } as const
    for (const [authName, authValue] of Object.entries(auth)) {
      for (const [privName, privValue] of Object.entries(priv)) {
        expect(
          buildSnmpV3User({
            username: 'u',
            authProtocol: authName as keyof typeof auth,
            authKey: 'auth-secret-1',
            privProtocol: privName as keyof typeof priv,
            privKey: 'priv-secret-1',
          }),
        ).toEqual({
          name: 'u',
          level: SecurityLevel.authPriv,
          authProtocol: authValue,
          authKey: 'auth-secret-1',
          privProtocol: privValue,
          privKey: 'priv-secret-1',
        })
      }
    }
  })

  it('defaults privacy to AES and ignores a privacy key without authentication', () => {
    expect(
      buildSnmpV3User({
        username: 'u',
        authKey: 'auth-secret-1',
        privKey: 'priv-secret-1',
      }),
    ).toMatchObject({ privProtocol: PrivProtocols.aes })
    expect(
      buildSnmpV3User({ username: 'u', privKey: 'priv-secret-1' }),
    ).toEqual({ name: 'u', level: SecurityLevel.noAuthNoPriv })
  })
})

describe('createNetSnmpSession', () => {
  it('opens a v2c session with the community by default', () => {
    createNetSnmpSession('10.0.0.1', {
      community: 'public',
      port: 161,
      timeoutMs: 1500,
    })
    expect(sessions.v2).toHaveBeenCalledWith(
      '10.0.0.1',
      'public',
      expect.objectContaining({ port: 161, timeout: 1500, retries: 0 }),
    )
  })

  it('opens a v3 session when credentials are given', () => {
    createNetSnmpSession('10.0.0.2', {
      community: '',
      port: 1161,
      timeoutMs: 1500,
      v3: { username: 'monitor', authKey: 'auth-secret-1' },
    })
    expect(sessions.v3).toHaveBeenCalledWith(
      '10.0.0.2',
      expect.objectContaining({
        name: 'monitor',
        level: SecurityLevel.authNoPriv,
      }),
      expect.objectContaining({ port: 1161, version: 3 }),
    )
  })
})
