import { describe, expect, it } from 'vitest'
import {
  buildMockBoletoLine,
  computePeerAdoption,
  daysUntil,
  decodeSignaturePng,
  formatChargeAmount,
  newChargeTxid,
  phoneVariants,
  proposalSignatureKey,
  proposalSnapshot,
  rankUpsell,
  renewalAlertBody,
  renewalDealName,
  renewalState,
  renewalWindowEnd,
  sha256,
  upsellTiming,
} from '@/src/lib/crm-deals'

const now = new Date('2026-10-30T12:00:00.000Z')
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000)

describe('payment helpers', () => {
  it('creates a 32-character txid', () => {
    const txid = newChargeTxid()
    expect(txid).toMatch(/^[0-9a-f]{32}$/)
    expect(newChargeTxid()).not.toBe(txid)
  })

  it('builds a deterministic test boleto line that starts with the fake bank', () => {
    const line = buildMockBoletoLine('abcdef0123456789abcdef0123456789', 1234.5)
    expect(line).toBe(buildMockBoletoLine('abcdef0123456789abcdef0123456789', 1234.5))
    expect(line.startsWith('999')).toBe(true)
    expect(line.replace(/\D/g, '')).toHaveLength(47)
    // 10-digit value in cents closes the line.
    expect(line.endsWith('0000' + '0000123450')).toBe(true)
  })

  it('never goes negative on the amount', () => {
    expect(buildMockBoletoLine('aa', -5).endsWith('0000000000')).toBe(true)
  })

  it('formats reais for people', () => {
    expect(formatChargeAmount(1500)).toContain('1.500,00')
  })
})

describe('proposal snapshot and signature', () => {
  const input = {
    id: 'p1',
    name: 'Proposta',
    validUntil: new Date('2026-12-01T02:59:59.999Z'),
    sections: [
      { type: 'PRICING', order: 1, enabled: true, content: { a: 1 } },
      { type: 'COVER', order: 0, enabled: true, content: { b: 2 } },
    ],
  }

  it('orders the sections so the hash is stable', () => {
    const swapped = { ...input, sections: [...input.sections].reverse() }
    expect(proposalSnapshot(input)).toBe(proposalSnapshot(swapped))
    expect(proposalSnapshot(input).indexOf('COVER')).toBeLessThan(
      proposalSnapshot(input).indexOf('PRICING'),
    )
  })

  it('changes the hash when the content changes and tolerates no validity', () => {
    const changed = { ...input, name: 'Outra' }
    expect(sha256(proposalSnapshot(input))).not.toBe(
      sha256(proposalSnapshot(changed)),
    )
    expect(proposalSnapshot({ ...input, validUntil: null })).toContain(
      '"validUntil":null',
    )
  })

  it('hashes buffers and strings alike', () => {
    expect(sha256('x')).toBe(sha256(Buffer.from('x')))
    expect(sha256('x')).toHaveLength(64)
  })

  it('decodes a real PNG header and refuses anything else', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('payload'),
    ])
    const ok = decodeSignaturePng(`data:image/png;base64,${png.toString('base64')}`)
    expect(ok.ok).toBe(true)
    const notPng = decodeSignaturePng(
      `data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}`,
    )
    expect(notPng.ok).toBe(false)
    const tiny = decodeSignaturePng('data:image/png;base64,iVBORw0KGgo=')
    expect(tiny.ok).toBe(false)
  })

  it('refuses a PNG over the size cap', () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(Math.round(1.6 * 1024 * 1024)),
    ])
    const result = decodeSignaturePng(
      `data:image/png;base64,${big.toString('base64')}`,
    )
    expect(result.ok).toBe(false)
  })

  it('builds the storage key under the workspace and proposal', () => {
    expect(proposalSignatureKey('w', 'p', 's')).toBe('w/p/signatures/s.png')
  })
})

describe('renewal helpers', () => {
  it('counts whole days, rounding up', () => {
    expect(daysUntil(inDays(10), now)).toBe(10)
    expect(daysUntil(new Date(now.getTime() + 3_600_000), now)).toBe(1)
    expect(daysUntil(inDays(-2), now)).toBe(-2)
  })

  it('classifies the contract against the lead window', () => {
    expect(renewalState(inDays(-1), 60, now)).toBe('OVERDUE')
    expect(renewalState(inDays(60), 60, now)).toBe('EXPIRING')
    expect(renewalState(inDays(0), 60, now)).toBe('EXPIRING')
    expect(renewalState(inDays(61), 60, now)).toBe('HEALTHY')
  })

  it('names the renewal deal and caps the length', () => {
    expect(renewalDealName('Plano')).toBe('Renovação — Plano')
    expect(renewalDealName('x'.repeat(300))).toHaveLength(200)
  })

  it('computes the window end', () => {
    expect(renewalWindowEnd(30, now).getTime()).toBe(inDays(30).getTime())
  })

  it('words the alert for past, today and future', () => {
    expect(renewalAlertBody('P', 'Acme', -3)).toContain('venceu há 3 dia(s)')
    expect(renewalAlertBody('P', 'Acme', 0)).toContain('vence hoje')
    expect(renewalAlertBody('P', 'Acme', 12)).toContain('vence em 12 dia(s)')
  })
})

describe('upsellTiming', () => {
  const answered = new Date(now)

  it('waits when the churn risk is high, whatever the survey says', () => {
    const result = upsellTiming({ kind: 'NPS', score: 10, answeredAt: answered }, 'HIGH')
    expect(result.timing).toBe('WAIT')
  })

  it('waits on a detractor, for NPS and for the 1-5 scales', () => {
    expect(
      upsellTiming({ kind: 'NPS', score: 6, answeredAt: answered }, 'LOW').timing,
    ).toBe('WAIT')
    expect(
      upsellTiming({ kind: 'CSAT', score: 2, answeredAt: answered }, null).timing,
    ).toBe('WAIT')
  })

  it('goes on a promoter with good health', () => {
    expect(
      upsellTiming({ kind: 'NPS', score: 9, answeredAt: answered }, 'LOW').timing,
    ).toBe('GO')
    expect(
      upsellTiming({ kind: 'CES', score: 5, answeredAt: answered }, null).timing,
    ).toBe('GO')
  })

  it('stays neutral on medium health or without a survey', () => {
    expect(
      upsellTiming({ kind: 'NPS', score: 10, answeredAt: answered }, 'MEDIUM').timing,
    ).toBe('NEUTRAL')
    const none = upsellTiming(null, 'LOW')
    expect(none.timing).toBe('NEUTRAL')
    expect(none.reason).toContain('Sem pesquisa')
    expect(
      upsellTiming({ kind: 'NPS', score: 8, answeredAt: answered }, 'LOW').reason,
    ).toContain('Sem sinal forte')
  })
})

describe('peer adoption and ranking', () => {
  const rows = [
    { productId: 'crm', name: 'CRM', unitPrice: 100, companyId: 'a' },
    { productId: 'zap', name: 'Zap', unitPrice: 50, companyId: 'a' },
    { productId: 'crm', name: 'CRM', unitPrice: 100, companyId: 'b' },
    { productId: 'zap', name: 'Zap', unitPrice: 55, companyId: 'b' },
    { productId: 'sd', name: 'ServiceDesk', unitPrice: 80, companyId: 'b' },
    { productId: 'crm', name: 'CRM', unitPrice: 100, companyId: 'c' },
    { productId: 'bi', name: 'BI', unitPrice: 30, companyId: 'd' },
  ]

  it('counts only peers who own what the account owns', () => {
    const result = computePeerAdoption(rows, new Set(['crm']))
    const zap = result.find((c) => c.productId === 'zap')
    expect(zap).toMatchObject({ buyers: 2, peers: 3 })
    // The account owns CRM, so it is never suggested.
    expect(result.some((c) => c.productId === 'crm')).toBe(false)
    // BI's only buyer does not own CRM, so it is not a peer.
    expect(result.some((c) => c.productId === 'bi')).toBe(false)
  })

  it('uses every customer as a peer when the account owns nothing', () => {
    const result = computePeerAdoption(rows, new Set())
    expect(result.find((c) => c.productId === 'crm')).toMatchObject({
      buyers: 3,
      peers: 4,
    })
  })

  it('ranks by buyers, then name, and trims to the limit', () => {
    const ranked = rankUpsell(
      [
        { productId: '1', name: 'B', buyers: 2, peers: 4, unitPrice: null },
        { productId: '2', name: 'A', buyers: 2, peers: 4, unitPrice: 10 },
        { productId: '3', name: 'C', buyers: 4, peers: 4, unitPrice: 5 },
        { productId: '4', name: 'D', buyers: 0, peers: 4, unitPrice: 1 },
        { productId: '5', name: 'E', buyers: 1, peers: 0, unitPrice: 1 },
      ],
      3,
    )
    expect(ranked.map((s) => s.name)).toEqual(['C', 'A', 'B'])
    expect(ranked[0]?.adoptionPct).toBe(100)
    expect(ranked[1]?.adoptionPct).toBe(50)
  })

  it('builds phone variants with and without the country code', () => {
    expect(phoneVariants(['(11) 99999-0000', '123', '5511988887777'])).toEqual([
      '11999990000',
      '5511999990000',
      '5511988887777',
    ])
  })
})
