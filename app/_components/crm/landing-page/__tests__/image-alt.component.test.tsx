import { describe, expect, it } from 'vitest'
import { imageAltKey } from '@/app/_components/crm/landing-page/image-alt'

describe('imageAltKey', () => {
  it('should be stable and valid as an override key', () => {
    const key = imageAltKey('https://x.test/a.png')
    expect(key).toBe(imageAltKey('https://x.test/a.png'))
    expect(key).toMatch(/^[a-zA-Z0-9_.-]{1,80}$/)
    expect(key).not.toBe(imageAltKey('https://x.test/b.png'))
  })
})
