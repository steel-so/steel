import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCnpjProfile } from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import {
  companyPatchFromProfile,
  domainFromEmails,
  isGenericEmailDomain,
} from '../cnpj/company-patch'

const patch = (
  over: Parameters<typeof createFakeCrmCompany>[0],
  profile: Parameters<typeof createFakeCnpjProfile>[0],
  overwrite = false,
) =>
  companyPatchFromProfile(
    createFakeCrmCompany(over),
    createFakeCnpjProfile(profile),
    overwrite,
  )

describe('companyPatchFromProfile', () => {
  it('fills everything on an empty company', () => {
    const r = patch({ name: 'Empresa 11.222.333/0001-81' }, {})
    expect(r.applied).toEqual([
      'name',
      'address',
      'legalName',
      'tradeName',
      'cnae',
      'size',
      'legalNature',
      'registrationStatus',
      'openedAt',
      'shareCapital',
      'emails',
      'phones',
    ])
    expect(r.data).toMatchObject({
      name: 'Acme Mercado',
      legalName: 'ACME COMERCIO DE ALIMENTOS LTDA',
      cnaeCode: '4711302',
      cnaeDescription: 'Comércio varejista de mercadorias em geral',
      size: 'EPP',
      openedAt: '2015-03-02',
      shareCapital: 50000,
      emails: ['contato@acme.com.br'],
      phones: ['(11) 2395-8400'],
    })
    expect(r.domainCandidate).toBe('acme.com.br')
  })

  it('uses the legal name when there is no trade name', () => {
    const r = patch({ name: '' }, { tradeName: null })
    expect(r.data.name).toBe('ACME COMERCIO DE ALIMENTOS LTDA')
  })

  it('never overwrites manual values without overwrite', () => {
    const r = patch(
      {
        name: 'Minha',
        address: { city: 'Rio' },
        legalName: 'Manual',
        tradeName: 'Manual',
        cnaeCode: '1',
        cnaeDescription: 'x',
        size: 'ME',
        legalNature: 'n',
        registrationStatus: 'BAIXADA',
        openedAt: new Date('2000-01-01T00:00:00Z'),
        shareCapital: new Prisma.Decimal(1),
        emails: ['contato@acme.com.br'],
        phones: ['11 2395-8400'],
        domain: 'meu.com',
      },
      {},
    )
    expect(r.applied).toEqual([])
    expect(r.data).toEqual({})
    expect(r.domainCandidate).toBeNull()
  })

  it('treats whitespace-only values as empty', () => {
    const r = patch({ legalName: '  ', address: { city: ' ' } }, {})
    expect(r.applied).toContain('legalName')
    expect(r.applied).toContain('address')
  })

  it('replaces differing values with overwrite and skips identical ones', () => {
    const r = patch(
      {
        name: 'Minha',
        legalName: 'ACME COMERCIO DE ALIMENTOS LTDA',
        size: 'ME',
        shareCapital: new Prisma.Decimal(50000),
        openedAt: new Date('2015-03-02T00:00:00Z'),
      },
      {},
      true,
    )
    expect(r.applied).toContain('name')
    expect(r.applied).toContain('size')
    expect(r.applied).not.toContain('legalName')
    expect(r.applied).not.toContain('shareCapital')
    expect(r.applied).not.toContain('openedAt')
  })

  it('applies cnae when only the description is missing', () => {
    const r = patch({ cnaeCode: '4711302' }, {})
    expect(r.applied).toContain('cnae')
    expect(r.data.cnaeCode).toBeUndefined()
    expect(r.data.cnaeDescription).toBeDefined()
  })

  it('skips fields the profile does not have', () => {
    const r = patch(
      {},
      {
        legalName: null,
        tradeName: null,
        cnaeCode: null,
        cnaeDescription: null,
        size: null,
        legalNature: null,
        registrationStatus: null,
        openedAt: null,
        shareCapital: null,
        address: null,
        emails: [],
        phones: [],
      },
    )
    expect(r.applied).toEqual([])
    expect(r.domainCandidate).toBeNull()
  })

  it('records a zero share capital', () => {
    const r = patch({}, { shareCapital: 0 })
    expect(r.data.shareCapital).toBe(0)
  })

  describe('emails and phones', () => {
    it('unions with existing values, deduplicating', () => {
      const r = patch(
        { emails: ['Contato@Acme.com.br'], phones: ['11 23958400'] },
        {
          emails: ['contato@acme.com.br', 'vendas@acme.com.br'],
          phones: ['(11) 2395-8400', '(11) 99999-0000'],
        },
      )
      expect(r.data.emails).toEqual([
        'Contato@Acme.com.br',
        'vendas@acme.com.br',
      ])
      expect(r.data.phones).toEqual(['11 23958400', '(11) 99999-0000'])
    })

    it('does not report applied when nothing new', () => {
      const r = patch(
        { emails: ['contato@acme.com.br'], phones: ['(11) 2395-8400'] },
        {},
      )
      expect(r.applied).not.toContain('emails')
      expect(r.applied).not.toContain('phones')
    })

    it('replaces with overwrite', () => {
      const r = patch(
        { emails: ['velho@x.com'], phones: ['(21) 1111-1111'] },
        {},
        true,
      )
      expect(r.data.emails).toEqual(['contato@acme.com.br'])
      expect(r.data.phones).toEqual(['(11) 2395-8400'])
    })

    it('keeps existing contacts with overwrite when the profile has none', () => {
      const r = patch({ emails: ['velho@x.com'] }, { emails: [] }, true)
      expect(r.data.emails).toBeUndefined()
    })

    it('treats missing profile contacts as empty', () => {
      const profile = createFakeCnpjProfile() as Partial<
        ReturnType<typeof createFakeCnpjProfile>
      >
      delete profile.emails
      delete profile.phones
      const r = companyPatchFromProfile(
        createFakeCrmCompany(),
        profile as never,
        false,
      )
      expect(r.applied).not.toContain('emails')
      expect(r.domainCandidate).toBeNull()
    })
  })

  describe('domain candidate', () => {
    it('is null when the company already has a domain', () => {
      expect(patch({ domain: 'meu.com' }, {}).domainCandidate).toBeNull()
    })

    it('skips generic providers and takes the first corporate one', () => {
      const r = patch(
        {},
        { emails: ['x@gmail.com', 'y@uol.com.br', 'z@corp.com.br'] },
      )
      expect(r.domainCandidate).toBe('corp.com.br')
    })

    it('is null when every e-mail is generic', () => {
      expect(
        patch({}, { emails: ['x@hotmail.com', 'y@yahoo.com.br'] })
          .domainCandidate,
      ).toBeNull()
    })

    it('can come from the company own e-mails', () => {
      const r = patch({ emails: ['a@minha.com'] }, { emails: [] })
      expect(r.domainCandidate).toBe('minha.com')
    })
  })
})

describe('domain helpers', () => {
  it.each([
    'gmail.com',
    'Hotmail.com',
    'outlook.com',
    'live.com',
    'yahoo.com',
    'yahoo.com.br',
    'uol.com.br',
    'bol.com.br',
    'terra.com.br',
    'icloud.com',
    'msn.com',
    'ig.com.br',
    'globo.com',
    'protonmail.com',
  ])('flags %s as generic', (d) => {
    expect(isGenericEmailDomain(d)).toBe(true)
  })

  it('ignores malformed addresses', () => {
    expect(domainFromEmails(['semarroba', 'a@b'])).toBeNull()
    expect(domainFromEmails([])).toBeNull()
  })
})
