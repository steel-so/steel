import { beforeEach, describe, expect, it, vi } from 'vitest'

const domains = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/src/lib/mail/client', () => ({ resend: { domains } }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  ResendDomains,
  toSendingDomainRecords,
  toSendingDomainStatus,
} from '../sending-domain/resend-domains'

const record = (kind: string, status: string) => ({
  record: kind,
  type: 'TXT',
  name: `${kind.toLowerCase()}.news`,
  value: 'v',
  ttl: 'Auto',
  status,
})

const fail = (message: string, statusCode: number | null = 422) => ({
  data: null,
  error: { message, statusCode, name: 'validation_error' },
  headers: null,
})

beforeEach(() => {
  for (const fn of Object.values(domains)) fn.mockReset()
})

describe('toSendingDomainStatus', () => {
  it.each([
    ['verified', 'VERIFIED'],
    ['failed', 'FAILED'],
    ['partially_failed', 'FAILED'],
    ['temporary_failure', 'TEMPORARY_FAILURE'],
    ['not_started', 'NOT_STARTED'],
    ['pending', 'PENDING'],
    ['something_new', 'PENDING'],
  ])('maps %s to %s', (provider, expected) => {
    expect(toSendingDomainStatus(provider, [])).toBe(expected)
  })

  it('counts partially_verified as VERIFIED only when SPF and DKIM are verified', () => {
    const sending = toSendingDomainRecords([
      record('SPF', 'verified'),
      record('DKIM', 'verified'),
      record('Tracking', 'pending'),
    ])
    expect(toSendingDomainStatus('partially_verified', sending)).toBe(
      'VERIFIED',
    )
    const missing = toSendingDomainRecords([
      record('SPF', 'verified'),
      record('DKIM', 'pending'),
    ])
    expect(toSendingDomainStatus('partially_verified', missing)).toBe('PENDING')
    expect(toSendingDomainStatus('partially_verified', [])).toBe('PENDING')
  })
})

describe('toSendingDomainRecords', () => {
  it('keeps the contract fields and drops provider extras', () => {
    expect(
      toSendingDomainRecords([
        {
          ...record('SPF', 'pending'),
          type: 'MX',
          priority: 10,
          routing_policy: 'x',
        } as never,
        { record: 'DKIM', type: 'CNAME', name: 'n', value: 'v', status: 's' },
      ]),
    ).toEqual([
      {
        record: 'SPF',
        type: 'MX',
        name: 'spf.news',
        value: 'v',
        ttl: 'Auto',
        priority: 10,
        status: 'pending',
      },
      { record: 'DKIM', type: 'CNAME', name: 'n', value: 'v', status: 's' },
    ])
    expect(toSendingDomainRecords(null)).toEqual([])
  })
})

describe('ResendDomains.create', () => {
  it('creates with tracking on and maps the response', async () => {
    domains.create.mockResolvedValue({
      data: {
        id: 'rd_1',
        status: 'not_started',
        records: [record('SPF', 'not_started')],
      },
      error: null,
      headers: null,
    })
    const result = expectOk(
      await ResendDomains.create('news.acme.com', 'sa-east-1'),
    )
    expect(domains.create).toHaveBeenCalledWith({
      name: 'news.acme.com',
      region: 'sa-east-1',
      openTracking: true,
      clickTracking: true,
    })
    expect(result).toMatchObject({
      id: 'rd_1',
      status: 'NOT_STARTED',
      providerStatus: 'not_started',
    })
    expect(result.records).toHaveLength(1)
  })

  it('maps "already registered" to SENDING_DOMAIN_TAKEN', async () => {
    domains.create.mockResolvedValue(
      fail('The domain news.acme.com has already been registered'),
    )
    expectErr(
      await ResendDomains.create('news.acme.com', 'sa-east-1'),
      'SENDING_DOMAIN_TAKEN',
    )
    domains.create.mockResolvedValue(fail('conflict', 409))
    expectErr(
      await ResendDomains.create('news.acme.com', 'sa-east-1'),
      'SENDING_DOMAIN_TAKEN',
    )
  })

  it('maps other errors, missing data and throws to PROVIDER_ERROR', async () => {
    domains.create.mockResolvedValue(fail('Invalid API key', 401))
    expectErr(
      await ResendDomains.create('a.com', 'sa-east-1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    domains.create.mockResolvedValue({ data: null, error: null, headers: null })
    expectErr(
      await ResendDomains.create('a.com', 'sa-east-1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    domains.create.mockRejectedValue(new Error('network'))
    expectErr(
      await ResendDomains.create('a.com', 'sa-east-1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    domains.create.mockRejectedValue('weird')
    expectErr(
      await ResendDomains.create('a.com', 'sa-east-1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
  })
})

describe('ResendDomains.verify / get / remove', () => {
  it('verifies', async () => {
    domains.verify.mockResolvedValue({ data: { id: 'rd_1' }, error: null })
    expectOk(await ResendDomains.verify('rd_1'))
    expect(domains.verify).toHaveBeenCalledWith('rd_1')
    domains.verify.mockResolvedValue(fail('nope', 500))
    expectErr(
      await ResendDomains.verify('rd_1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    domains.verify.mockRejectedValue(new Error('down'))
    expectErr(
      await ResendDomains.verify('rd_1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
  })

  it('gets', async () => {
    domains.get.mockResolvedValue({
      data: { id: 'rd_1', status: 'verified', records: [] },
      error: null,
    })
    expect(expectOk(await ResendDomains.get('rd_1')).status).toBe('VERIFIED')
    domains.get.mockResolvedValue(fail('not found', 404))
    expectErr(await ResendDomains.get('rd_1'), 'SENDING_DOMAIN_PROVIDER_ERROR')
    domains.get.mockRejectedValue(new Error('down'))
    expectErr(await ResendDomains.get('rd_1'), 'SENDING_DOMAIN_PROVIDER_ERROR')
  })

  it('removes, treating 404 as done', async () => {
    domains.remove.mockResolvedValue({ data: { id: 'rd_1' }, error: null })
    expectOk(await ResendDomains.remove('rd_1'))
    domains.remove.mockResolvedValue(fail('not found', 404))
    expectOk(await ResendDomains.remove('rd_1'))
    domains.remove.mockResolvedValue(fail('boom', 500))
    expectErr(
      await ResendDomains.remove('rd_1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    domains.remove.mockRejectedValue(new Error('down'))
    expectErr(
      await ResendDomains.remove('rd_1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
  })
})
