import { describe, expect, it } from 'vitest'
import { GenerateSiteSchema } from '@/src/schemas/site-ai.schema'

const base = {
  name: 'Padaria',
  business: 'Padaria artesanal com entregas na cidade',
  goal: 'leads',
  tone: 'friendly',
}
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

describe('GenerateSiteSchema inspirationImages', () => {
  it('defaults to none and accepts data URL images', () => {
    expect(GenerateSiteSchema.parse(base).inspirationImages).toEqual([])
    expect(
      GenerateSiteSchema.parse({ ...base, inspirationImages: [IMAGE] })
        .inspirationImages,
    ).toEqual([IMAGE])
  })

  it('rejects remote URLs, other types and more than four images', () => {
    for (const bad of [
      'https://exemplo.com/a.png',
      'data:text/html;base64,PGgxPg==',
      'data:image/svg+xml;base64,PHN2Zz4=',
    ]) {
      expect(
        GenerateSiteSchema.safeParse({ ...base, inspirationImages: [bad] })
          .success,
      ).toBe(false)
    }
    expect(
      GenerateSiteSchema.safeParse({
        ...base,
        inspirationImages: Array(5).fill(IMAGE),
      }).success,
    ).toBe(false)
  })
})
