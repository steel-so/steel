import { describe, expect, it, vi } from 'vitest'
import { lookupDmarc } from '../sending-domain/dmarc'

const SUGGESTED = 'v=DMARC1; p=none;'

describe('lookupDmarc', () => {
  it('queries the registrable domain and returns the DMARC record', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([
        ['google-site-verification=abc'],
        ['v=DMARC1; p=quarantine; ', 'rua=mailto:d@acme.com.br'],
      ])
    const result = await lookupDmarc('news.acme.com.br', { resolver })
    expect(resolver).toHaveBeenCalledWith('_dmarc.acme.com.br')
    expect(result).toEqual({
      name: '_dmarc.acme.com.br',
      found: true,
      value: 'v=DMARC1; p=quarantine; rua=mailto:d@acme.com.br',
      suggested: SUGGESTED,
    })
  })

  it('reports not found when TXT exists without DMARC', async () => {
    const resolver = vi.fn().mockResolvedValue([['v=spf1 -all']])
    const result = await lookupDmarc('acme.com', { resolver })
    expect(result).toMatchObject({ found: false, value: null })
  })

  it.each(['ENOTFOUND', 'ENODATA'])('treats %s as not found', async (code) => {
    const resolver = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(code), { code }))
    expect(await lookupDmarc('acme.com', { resolver })).toMatchObject({
      found: false,
    })
  })

  it('returns unknown on other DNS errors', async () => {
    const resolver = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'ESERVFAIL' }))
    expect(await lookupDmarc('acme.com', { resolver })).toMatchObject({
      found: null,
      value: null,
    })
    const plain = vi.fn().mockRejectedValue(null)
    expect(await lookupDmarc('acme.com', { resolver: plain })).toMatchObject({
      found: null,
    })
  })

  it('returns unknown when the lookup times out', async () => {
    const resolver = vi.fn(() => new Promise<string[][]>(() => {}))
    expect(
      await lookupDmarc('acme.com', { resolver, timeoutMs: 5 }),
    ).toMatchObject({ found: null, name: '_dmarc.acme.com' })
  })

  it('uses node:dns by default', async () => {
    vi.resetModules()
    vi.doMock('node:dns/promises', () => ({
      resolveTxt: vi.fn().mockResolvedValue([['v=DMARC1; p=none']]),
    }))
    const { lookupDmarc: fresh } = await import('../sending-domain/dmarc')
    expect(await fresh('acme.com')).toMatchObject({ found: true })
    vi.doUnmock('node:dns/promises')
  })
})
