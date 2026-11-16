import { describe, expect, it } from 'vitest'
import { mergeCnpjProfiles } from '../cnpj/merge'
import type { CnpjProfile } from '../cnpj/provider'

const EMPTY: CnpjProfile = {
  cnpj: '11222333000181',
  legalName: null,
  tradeName: null,
  cnaeCode: null,
  cnaeDescription: null,
  secondaryCnaes: [],
  size: null,
  legalNature: null,
  registrationStatus: null,
  openedAt: null,
  shareCapital: null,
  partners: [],
  address: null,
  emails: [],
  phones: [],
}

const profile = (patch: Partial<CnpjProfile>): CnpjProfile => ({
  ...EMPTY,
  ...patch,
})

describe('mergeCnpjProfiles()', () => {
  it('throws without profiles and returns a single one untouched', () => {
    expect(() => mergeCnpjProfiles([])).toThrow()
    const only = profile({ legalName: 'A' })
    expect(mergeCnpjProfiles([only])).toBe(only)
  })

  it('takes each field from the first source that has it', () => {
    const merged = mergeCnpjProfiles([
      profile({ legalName: 'FIRST', tradeName: '  ', size: null }),
      profile({ legalName: 'SECOND', tradeName: 'Trade', size: 'ME' }),
    ])
    expect(merged).toMatchObject({
      legalName: 'FIRST',
      tradeName: 'Trade',
      size: 'ME',
    })
  })

  it('prefers a positive capital over a zero', () => {
    expect(
      mergeCnpjProfiles([
        profile({ shareCapital: 0 }),
        profile({ shareCapital: 5000 }),
      ]).shareCapital,
    ).toBe(5000)
    expect(
      mergeCnpjProfiles([profile({ shareCapital: 0 }), profile({})])
        .shareCapital,
    ).toBe(0)
  })

  it('unites partners (ignoring case and accents) and CNAEs', () => {
    const merged = mergeCnpjProfiles([
      profile({
        partners: [
          { name: 'José Silva', qualification: null, enteredAt: null },
        ],
        secondaryCnaes: [{ code: '1', description: '' }],
      }),
      profile({
        partners: [
          {
            name: 'JOSE SILVA',
            qualification: 'Sócio',
            enteredAt: '2020-01-01',
          },
          { name: 'Ana', qualification: null, enteredAt: null },
        ],
        secondaryCnaes: [
          { code: '1', description: 'Um' },
          { code: '2', description: 'Dois' },
        ],
      }),
    ])
    expect(merged.partners).toEqual([
      { name: 'José Silva', qualification: 'Sócio', enteredAt: '2020-01-01' },
      { name: 'Ana', qualification: null, enteredAt: null },
    ])
    expect(merged.secondaryCnaes).toEqual([
      { code: '1', description: 'Um' },
      { code: '2', description: 'Dois' },
    ])
  })

  it('keeps one address and fills gaps only from the same ZIP', () => {
    const merged = mergeCnpjProfiles([
      profile({
        address: {
          zipCode: '01001-000',
          street: 'Rua A',
          city: 'São Paulo',
          state: 'SP',
        },
      }),
      profile({
        address: {
          zipCode: '01.001-000',
          street: 'R A',
          number: '10',
          neighborhood: 'Centro',
        },
      }),
      profile({
        address: { zipCode: '99999-000', complement: 'Sala 9', number: '777' },
      }),
    ])
    expect(merged.address).toEqual({
      zipCode: '01001-000',
      street: 'Rua A',
      city: 'São Paulo',
      state: 'SP',
      number: '10',
      neighborhood: 'Centro',
    })
  })

  it('starts from the first complete address, not the first one', () => {
    const merged = mergeCnpjProfiles([
      profile({ address: { zipCode: '01001-000' } }),
      profile({
        address: {
          zipCode: '01001-000',
          street: 'Rua B',
          city: 'Rio',
          state: 'RJ',
        },
      }),
    ])
    expect(merged.address).toMatchObject({ street: 'Rua B', state: 'RJ' })
  })

  it('unions emails and phones, deduplicating by normalized value', () => {
    const merged = mergeCnpjProfiles([
      profile({
        emails: ['a@x.com', 'b@x.com'],
        phones: ['(11) 2395-8400'],
      }),
      profile({
        emails: ['A@x.com', 'c@x.com'],
        phones: ['1123958400', '(11) 99999-0000'],
      }),
    ])
    expect(merged.emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
    expect(merged.phones).toEqual(['(11) 2395-8400', '(11) 99999-0000'])
  })
})
