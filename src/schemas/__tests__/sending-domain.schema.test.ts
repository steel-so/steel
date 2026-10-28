import { describe, expect, it } from 'vitest'
import {
  CreateSendingDomainSchema,
  SendingDomainRecordSchema,
} from '../sending-domain.schema'

describe('CreateSendingDomainSchema', () => {
  it('normalizes the name and defaults the region to São Paulo', () => {
    expect(
      CreateSendingDomainSchema.parse({
        name: '  HTTPS://News.Acme.com.br/path ',
      }),
    ).toEqual({ name: 'news.acme.com.br', region: 'sa-east-1' })
  })

  it.each([
    'gmail.com',
    'stratustelecom.com.br',
    'acme',
    'not a domain',
    '-a.com',
  ])('refuses %s', (name) => {
    expect(CreateSendingDomainSchema.safeParse({ name }).success).toBe(false)
  })

  it('refuses an unknown region', () => {
    expect(
      CreateSendingDomainSchema.safeParse({
        name: 'news.acme.com',
        region: 'mars-1',
      }).success,
    ).toBe(false)
  })
})

describe('SendingDomainRecordSchema', () => {
  it('accepts a Resend record with optional ttl and priority', () => {
    expect(
      SendingDomainRecordSchema.parse({
        record: 'SPF',
        type: 'MX',
        name: 'send.news',
        value: 'feedback-smtp.sa-east-1.amazonses.com',
        priority: 10,
        status: 'pending',
      }),
    ).toMatchObject({ priority: 10 })
  })
})
