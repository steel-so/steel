import { describe, expect, it } from 'vitest'
import { isPublicTvPath, TV_REQUEST_HEADER } from '@/src/lib/tv-request'

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
