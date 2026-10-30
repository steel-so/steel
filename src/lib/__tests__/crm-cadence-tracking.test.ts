import { describe, expect, it } from 'vitest'
import {
  addCadenceTracking,
  cadenceClickUrl,
  cadenceOpenPixelUrl,
  createCadenceClickToken,
  createCadenceOpenToken,
  isTrackableUrl,
  verifyCadenceClickToken,
  verifyCadenceOpenToken,
} from '../crm-cadence/tracking'

const BASE = 'https://app.example.com/'

describe('open token', () => {
  it('should round-trip the run id', () => {
    const token = createCadenceOpenToken('run_1')
    expect(verifyCadenceOpenToken(token)).toBe('run_1')
  })

  it.each([
    ['tampered signature', 'run_1.AAAAAAAAAAAAAAAAAAAAAA'],
    [
      'another run id',
      `run_2.${createCadenceOpenToken('run_1').split('.')[1]}`,
    ],
    ['no dot', 'run_1'],
    ['empty signature', 'run_1.'],
    ['leading dot', '.sig'],
    ['short signature', 'run_1.abc'],
  ])('should reject %s', (_name, token) => {
    expect(verifyCadenceOpenToken(token)).toBeNull()
  })

  it('should not accept a click token as an open token', () => {
    const click = createCadenceClickToken('run_1', 'https://a.com')
    expect(verifyCadenceOpenToken(click)).toBeNull()
  })
})

describe('click token', () => {
  it('should be valid only for the signed destination', () => {
    const token = createCadenceClickToken('run_1', 'https://a.com/x')
    expect(verifyCadenceClickToken(token, 'https://a.com/x')).toBe('run_1')
    expect(verifyCadenceClickToken(token, 'https://evil.com/x')).toBeNull()
    expect(verifyCadenceClickToken('nope', 'https://a.com/x')).toBeNull()
  })
})

describe('urls', () => {
  it('should build the pixel and click urls without a double slash', () => {
    expect(cadenceOpenPixelUrl(BASE, 'run_1')).toMatch(
      /^https:\/\/app\.example\.com\/api\/crm\/cadences\/o\/run_1\./,
    )
    const click = cadenceClickUrl(BASE, 'run_1', 'https://a.com/p?q=1&r=2')
    expect(click).toMatch(
      /^https:\/\/app\.example\.com\/api\/crm\/cadences\/c\/run_1\.[\w-]+\?u=https%3A%2F%2Fa\.com%2Fp%3Fq%3D1%26r%3D2$/,
    )
  })

  it.each([
    ['https://a.com', true],
    ['http://a.com/x?y=1', true],
    ['mailto:a@b.com', false],
    ['javascript:alert(1)', false],
    ['//a.com', false],
    ['https://a.com/ b', false],
    ['', false],
  ])('should decide whether %s is trackable', (url, expected) => {
    expect(isTrackableUrl(url)).toBe(expected)
  })
})

describe('addCadenceTracking()', () => {
  it('should rewrite web links and append the pixel', () => {
    const html =
      '<p><a href="https://a.com/p?x=1&amp;y=2">link</a> <a href="mailto:a@b.com">mail</a></p>'
    const out = addCadenceTracking(html, 'run_1', BASE)
    const token = createCadenceClickToken('run_1', 'https://a.com/p?x=1&y=2')
    expect(out).toContain(
      `href="https://app.example.com/api/crm/cadences/c/${token}?u=https%3A%2F%2Fa.com%2Fp%3Fx%3D1%26y%3D2"`,
    )
    expect(out).toContain('href="mailto:a@b.com"')
    expect(out.endsWith('/>')).toBe(true)
    expect(out).toContain('/api/crm/cadences/o/run_1.')
  })

  it('should still add the pixel to a message without links', () => {
    const out = addCadenceTracking('<p>oi</p>', 'run_1', BASE)
    expect(out).toMatch(/^<p>oi<\/p><img src="[^"]+cadences\/o\/run_1\./)
  })
})
