import { describe, expect, it } from 'vitest'
import {
  classifyRedirectUri,
  consentClientLabel,
  isLoopbackHostname,
  KNOWN_OAUTH_CLIENTS,
} from '@/src/lib/mcp/client-trust'

describe('classifyRedirectUri', () => {
  it('verifies the known clients by host', () => {
    expect(
      classifyRedirectUri('https://claude.ai/api/mcp/auth_callback'),
    ).toEqual({ trust: 'verified', host: 'claude.ai', verifiedName: 'Claude' })
    expect(classifyRedirectUri('https://claude.com/cb')?.verifiedName).toBe(
      'Claude',
    )
    expect(
      classifyRedirectUri(
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ),
    ).toEqual({
      trust: 'verified',
      host: 'chatgpt.com',
      verifiedName: 'ChatGPT',
    })
    expect(
      classifyRedirectUri('https://platform.openai.com/cb')?.verifiedName,
    ).toBe('ChatGPT')
    expect(classifyRedirectUri('https://www.cursor.com/cb')?.verifiedName).toBe(
      'Cursor',
    )
    expect(classifyRedirectUri('https://cursor.sh/cb')?.verifiedName).toBe(
      'Cursor',
    )
  })

  it('verifies the private-use scheme of a known native app', () => {
    expect(
      classifyRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'),
    ).toEqual({
      trust: 'verified',
      host: 'cursor://anysphere.cursor-mcp',
      verifiedName: 'Cursor',
    })
  })

  it('does not verify an unknown private-use scheme', () => {
    expect(classifyRedirectUri('com.example.app:/oauth')).toEqual({
      trust: 'unverified',
      host: 'com.example.app://',
      verifiedName: null,
    })
  })

  it('ignores userinfo: the host is what comes after the @', () => {
    expect(classifyRedirectUri('https://claude.ai@evil.com/cb')).toEqual({
      trust: 'unverified',
      host: 'evil.com',
      verifiedName: null,
    })
    expect(
      classifyRedirectUri('https://claude.ai:pass@evil.com/cb')?.host,
    ).toBe('evil.com')
  })

  it('does not match a known domain used as a prefix or inside a label', () => {
    expect(classifyRedirectUri('https://claude.ai.evil.com/cb')).toEqual({
      trust: 'unverified',
      host: 'claude.ai.evil.com',
      verifiedName: null,
    })
    expect(classifyRedirectUri('https://notclaude.ai/cb')?.trust).toBe(
      'unverified',
    )
    expect(classifyRedirectUri('https://evil.com/claude.ai')?.trust).toBe(
      'unverified',
    )
  })

  it('shows IDNs in punycode, so a look-alike never reads as the real host', () => {
    // "clаude.ai" with a Cyrillic "а".
    const lookalike = classifyRedirectUri('https://clаude.ai/cb')
    expect(lookalike?.trust).toBe('unverified')
    expect(lookalike?.host).toMatch(/^xn--/)
    expect(lookalike?.host).not.toContain('а')
    expect(classifyRedirectUri('https://bücher.example/cb')?.host).toBe(
      'xn--bcher-kva.example',
    )
  })

  it('keeps a non-default port in the host and still verifies the domain', () => {
    expect(classifyRedirectUri('https://claude.ai:8443/cb')).toEqual({
      trust: 'verified',
      host: 'claude.ai:8443',
      verifiedName: 'Claude',
    })
    expect(classifyRedirectUri('https://evil.com:443/cb')?.host).toBe(
      'evil.com',
    )
  })

  it('normalizes case and a trailing dot', () => {
    expect(classifyRedirectUri('https://CLAUDE.AI./cb')).toEqual({
      trust: 'verified',
      host: 'claude.ai',
      verifiedName: 'Claude',
    })
  })

  it('needs HTTPS to verify a web host', () => {
    expect(classifyRedirectUri('http://claude.ai/cb')).toEqual({
      trust: 'unverified',
      host: 'claude.ai',
      verifiedName: null,
    })
  })

  it('classifies loopback redirects as an app on the user computer', () => {
    expect(classifyRedirectUri('http://127.0.0.1:33418/callback')).toEqual({
      trust: 'loopback',
      host: '127.0.0.1:33418',
      verifiedName: null,
    })
    expect(classifyRedirectUri('http://localhost:6274/cb')?.trust).toBe(
      'loopback',
    )
    expect(classifyRedirectUri('http://[::1]:9000/cb')).toEqual({
      trust: 'loopback',
      host: '[::1]:9000',
      verifiedName: null,
    })
    // A loopback name in the userinfo is not a loopback host.
    expect(classifyRedirectUri('http://localhost@evil.com/cb')?.trust).toBe(
      'unverified',
    )
    expect(classifyRedirectUri('http://localhost.evil.com/cb')?.trust).toBe(
      'unverified',
    )
  })

  it('returns null for a missing or malformed redirect URI', () => {
    expect(classifyRedirectUri(null)).toBeNull()
    expect(classifyRedirectUri(undefined)).toBeNull()
    expect(classifyRedirectUri('')).toBeNull()
    expect(classifyRedirectUri('not a url')).toBeNull()
    expect(classifyRedirectUri('https://')).toBeNull()
  })

  it('keeps the allowlist matched by domain only', () => {
    for (const client of KNOWN_OAUTH_CLIENTS) {
      expect(client.domains.length).toBeGreaterThan(0)
      for (const domain of client.domains) {
        expect(domain).toBe(domain.toLowerCase())
        expect(domain).not.toMatch(/[/:@]/)
      }
    }
  })
})

describe('isLoopbackHostname', () => {
  it('accepts localhost, 127.0.0.0/8 and ::1', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('LOCALHOST')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.10.20.30')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
    expect(isLoopbackHostname('127.0.0.256')).toBe(false)
    expect(isLoopbackHostname('127.0.0')).toBe(false)
    expect(isLoopbackHostname('127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
  })
})

describe('consentClientLabel', () => {
  it('names a verified client from the allowlist, not from its registration', () => {
    expect(
      consentClientLabel(
        { trust: 'verified', host: 'claude.ai', verifiedName: 'Claude' },
        'Totally Claude',
      ),
    ).toBe('Claude')
  })

  it('keeps the declared name of a loopback app', () => {
    const loopback = {
      trust: 'loopback' as const,
      host: 'localhost:1',
      verifiedName: null,
    }
    expect(consentClientLabel(loopback, ' Claude Code ')).toBe('Claude Code')
    expect(consentClientLabel(loopback, null)).toBe('app no seu computador')
  })

  it('identifies an unverified client by its host', () => {
    expect(
      consentClientLabel(
        { trust: 'unverified', host: 'evil.example', verifiedName: null },
        'Claude',
      ),
    ).toBe('app em evil.example')
  })
})
