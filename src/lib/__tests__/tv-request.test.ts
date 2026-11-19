import { describe, expect, it } from 'vitest'
import {
  isPublicBioPath,
  isPublicTvPath,
  TV_REQUEST_HEADER,
} from '@/src/lib/tv-request'

describe('isPublicTvPath', () => {
  it('matches the public TV pages only', () => {
    expect(isPublicTvPath('/tv')).toBe(true)
    expect(isPublicTvPath('/tv/abc123')).toBe(true)
    expect(isPublicTvPath('/tvx')).toBe(false)
    expect(isPublicTvPath('/stratus-lab/crm/dashboards/d1/tv')).toBe(false)
    expect(isPublicTvPath('/api/crm/tv/abc')).toBe(false)
  })

  it('uses a dedicated request header', () => {
    expect(TV_REQUEST_HEADER).toBe('x-steel-tv')
  })
})

describe('isPublicBioPath', () => {
  it('matches the public bio pages only', () => {
    expect(isPublicBioPath('/b/minha-loja')).toBe(true)
    expect(isPublicBioPath('/b/minha-loja/l/abc')).toBe(true)
    expect(isPublicBioPath('/b')).toBe(false)
    expect(isPublicBioPath('/b/')).toBe(false)
    expect(isPublicBioPath('/blog/x')).toBe(false)
    expect(isPublicBioPath('/stratus-lab/crm/bio-links')).toBe(false)
  })
})
