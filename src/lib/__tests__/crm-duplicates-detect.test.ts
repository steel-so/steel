import { describe, expect, it } from 'vitest'
import {
  type CompanyRecord,
  findCompanyDuplicates,
  findCompanyMatches,
  findPersonDuplicates,
  findPersonMatches,
  type PersonRecord,
} from '../crm-duplicates/detect'

const person = (
  id: string,
  over: Partial<PersonRecord> = {},
): PersonRecord => ({
  id,
  name: `Pessoa ${id}`,
  emails: [],
  phones: [],
  companyId: null,
  ...over,
})

const company = (
  id: string,
  over: Partial<CompanyRecord> = {},
): CompanyRecord => ({
  id,
  name: `Empresa ${id}`,
  cnpj: null,
  domain: null,
  ...over,
})

describe('findPersonDuplicates', () => {
  it('pairs people sharing an e-mail, case-insensitively', () => {
    const pairs = findPersonDuplicates([
      person('a', { name: 'Ana Souza', emails: ['Ana@acme.com'] }),
      person('b', { name: 'Carlos Lima', emails: ['ana@ACME.com'] }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({
      leftId: 'a',
      rightId: 'b',
      reasons: ['email'],
    })
    expect(pairs[0].score).toBe(95)
  })

  it('weakens shared mailboxes under the minimum', () => {
    const pairs = findPersonDuplicates([
      person('a', { name: 'Ana Souza', emails: ['contato@acme.com'] }),
      person('b', { name: 'Carlos Lima', emails: ['contato@acme.com'] }),
    ])
    expect(pairs).toHaveLength(0)
  })

  it('pairs people sharing a phone in different formats', () => {
    const pairs = findPersonDuplicates([
      person('a', { name: 'Ana Souza', phones: ['(11) 98765-4321'] }),
      person('b', { name: 'Carlos Lima', phones: ['+55 11 98765 4321'] }),
    ])
    expect(pairs[0].reasons).toEqual(['phone'])
    expect(pairs[0].score).toBe(85)
  })

  it('pairs near-identical names and orders ids', () => {
    const pairs = findPersonDuplicates([
      person('z', { name: 'Maria da Silva' }),
      person('b', { name: 'Maria  da Silva' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({
      leftId: 'b',
      rightId: 'z',
      reasons: ['name'],
    })
  })

  it('does not pair different names', () => {
    expect(
      findPersonDuplicates([
        person('a', { name: 'Maria Silva' }),
        person('b', { name: 'Pedro Santos' }),
      ]),
    ).toHaveLength(0)
  })

  it('adds points for more signals and for the same company', () => {
    const pairs = findPersonDuplicates([
      person('a', {
        name: 'Ana Souza',
        emails: ['ana@acme.com'],
        phones: ['11987654321'],
        companyId: 'c1',
      }),
      person('b', {
        name: 'Ana Souza',
        emails: ['ana@acme.com'],
        phones: ['11987654321'],
        companyId: 'c1',
      }),
    ])
    expect(pairs[0].reasons).toEqual(['email', 'name', 'phone'])
    expect(pairs[0].score).toBe(100)
  })

  it('accepts a looser name inside the same company', () => {
    const near = [
      person('a', { name: 'Joao Pereira', companyId: 'c1' }),
      person('b', { name: 'Joao Pereir', companyId: 'c1' }),
    ]
    expect(findPersonDuplicates(near)).toHaveLength(1)
    expect(
      findPersonDuplicates(near.map((p) => ({ ...p, companyId: null }))),
    ).toHaveLength(0)
  })

  it('skips names that are too short to compare', () => {
    expect(
      findPersonDuplicates([
        person('a', { name: 'Al' }),
        person('b', { name: 'Al' }),
      ]),
    ).toHaveLength(0)
  })

  it('only compares identical names inside oversize blocks', () => {
    const crowd = Array.from({ length: 320 }, (_, i) =>
      person(`p${String(i).padStart(3, '0')}`, {
        name: `Maria ${'x'.repeat((i % 5) + 1)}`,
      }),
    )
    const pairs = findPersonDuplicates(crowd)
    expect(pairs.every((pair) => pair.reasons.includes('name'))).toBe(true)
  })

  it('ignores huge exact-key groups', () => {
    const crowd = Array.from({ length: 320 }, (_, i) =>
      person(`p${i}`, {
        name: `Fulano ${i * 7919}`,
        emails: ['same@acme.com'],
      }),
    )
    expect(findPersonDuplicates(crowd)).toHaveLength(0)
  })
})

describe('findCompanyDuplicates', () => {
  it('pairs the same CNPJ typed differently', () => {
    const pairs = findCompanyDuplicates([
      company('a', { name: 'Acme', cnpj: '12.345.678/0001-95' }),
      company('b', { name: 'Outra', cnpj: '12345678000195' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ reasons: ['cnpj'], score: 100 })
  })

  it('pairs the same domain', () => {
    const pairs = findCompanyDuplicates([
      company('a', { name: 'Acme', domain: 'https://www.acme.com' }),
      company('b', { name: 'Outra', domain: 'acme.com' }),
    ])
    expect(pairs[0]).toMatchObject({ reasons: ['domain'], score: 90 })
  })

  it('pairs names that differ only by the legal form', () => {
    const pairs = findCompanyDuplicates([
      company('a', { name: 'Acme Tecnologia Ltda' }),
      company('b', { name: 'ACME Tecnologia' }),
    ])
    expect(pairs[0].reasons).toEqual(['name'])
  })
})

describe('arrival matches', () => {
  it('returns only the pairs of the probe', () => {
    const probe = person('new', { name: 'Ana Souza', emails: ['ana@acme.com'] })
    const others = [
      person('x', { name: 'Ana S', emails: ['ana@acme.com'] }),
      person('y', { name: 'Bruno', emails: ['b@b.com'] }),
      person('z', { name: 'Bruna', emails: ['b@b.com'] }),
    ]
    const matches = findPersonMatches(probe, others)
    expect(matches).toHaveLength(1)
    expect(matches[0].leftId === 'new' || matches[0].rightId === 'new').toBe(
      true,
    )
  })

  it('does not pair the probe with itself', () => {
    const probe = person('new', { name: 'Ana Souza', emails: ['ana@acme.com'] })
    expect(findPersonMatches(probe, [probe])).toHaveLength(0)
  })

  it('matches a company probe', () => {
    const probe = company('new', { name: 'Acme', cnpj: '12345678000195' })
    const matches = findCompanyMatches(probe, [
      company('old', { name: 'Zeta', cnpj: '12.345.678/0001-95' }),
      company('no', { name: 'Omega' }),
    ])
    expect(matches).toHaveLength(1)
    expect(findCompanyMatches(probe, [probe])).toHaveLength(0)
  })
})
