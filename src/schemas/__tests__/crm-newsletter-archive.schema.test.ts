import { describe, expect, it } from 'vitest'
import { NewsletterArchivePageSchema } from '../crm-newsletter-archive.schema'

describe('NewsletterArchivePageSchema', () => {
  it('should coerce a valid page number', () => {
    expect(NewsletterArchivePageSchema.parse('3')).toBe(3)
  })

  it.each([undefined, '', '0', '-2', 'abc', '1.5', '99999', ['2', '3']])(
    'should fall back to 1 for %j',
    (value) => {
      expect(NewsletterArchivePageSchema.parse(value)).toBe(1)
    },
  )
})
