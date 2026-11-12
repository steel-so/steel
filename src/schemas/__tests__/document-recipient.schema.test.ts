import { describe, expect, it } from 'vitest'
import { SendDocumentSchema } from '@/src/schemas/document.schema'

const parse = (recipient: Record<string, unknown>) =>
  SendDocumentSchema.safeParse({ recipients: [recipient] })

describe('document recipient', () => {
  it('phone only → WhatsApp, stored with 55', () => {
    const result = parse({ name: 'Ana', phone: '(11) 98888-7777' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.recipients[0]).toMatchObject({
        phone: '5511988887777',
        channel: 'WHATSAPP',
      })
    }
  })
  it('e-mail only → e-mail', () => {
    const result = parse({ name: 'Ana', email: 'ana@x.com', phone: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.recipients[0]?.channel).toBe('EMAIL')
    }
  })
  it('neither → link only', () => {
    const result = parse({ name: 'Ana' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.recipients[0]?.channel).toBe('LINK')
  })
  it('both → rejected', () => {
    expect(
      parse({ name: 'Ana', email: 'ana@x.com', phone: '11988887777' }).success,
    ).toBe(false)
  })
  it('invalid phone → rejected', () => {
    expect(parse({ name: 'Ana', phone: '12' }).success).toBe(false)
  })
})
