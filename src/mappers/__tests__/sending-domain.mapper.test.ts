import { describe, expect, it } from 'vitest'
import {
  createFakeSendingDomain,
  fakeSendingDomainRecords,
} from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import {
  toSendingDomainDTO,
  toSendingDomainRecordList,
} from '../sending-domain.mapper'

describe('toSendingDomainDTO', () => {
  it('maps the row with ISO dates and the newsletter count', () => {
    const at = new Date('2026-10-28T15:00:00.000Z')
    const domain = createFakeSendingDomain({
      id: 'd1',
      status: 'VERIFIED',
      lastCheckedAt: at,
      verifiedAt: at,
    })
    expect(toSendingDomainDTO(domain, 2)).toEqual({
      id: 'd1',
      name: 'news.acme.com.br',
      status: 'VERIFIED',
      region: 'sa-east-1',
      records: fakeSendingDomainRecords(),
      failureReason: null,
      lastCheckedAt: '2026-10-28T15:00:00.000Z',
      verifiedAt: '2026-10-28T15:00:00.000Z',
      newslettersCount: 2,
      createdAt: '2026-10-28T12:00:00.000Z',
    })
  })

  it('adds the DMARC hint when given and keeps null dates', () => {
    const dmarc = {
      name: '_dmarc.acme.com.br',
      found: false,
      value: null,
      suggested: 'v=DMARC1; p=none;',
    }
    const dto = toSendingDomainDTO(createFakeSendingDomain(), 0, dmarc)
    expect(dto.dmarc).toEqual(dmarc)
    expect(dto.lastCheckedAt).toBeNull()
    expect(dto.verifiedAt).toBeNull()
  })
})

describe('toSendingDomainRecordList', () => {
  it('drops malformed entries and non-arrays', () => {
    expect(
      toSendingDomainRecordList([
        { record: 'SPF', type: 'TXT', name: 'n', value: 'v', status: 'ok' },
        { record: 'broken' },
        null,
      ]),
    ).toEqual([
      { record: 'SPF', type: 'TXT', name: 'n', value: 'v', status: 'ok' },
    ])
    expect(toSendingDomainRecordList({})).toEqual([])
  })
})
