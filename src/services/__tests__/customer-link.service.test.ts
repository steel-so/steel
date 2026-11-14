import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/customer-link.repository', async (orig) => ({
  ...(await orig<
    typeof import('@/src/repositories/customer-link.repository')
  >()),
  CustomerLinkRepository: {
    findCompany: vi.fn(),
    findCompanyByCnpj: vi.fn(),
    findPerson: vi.fn(),
    listPeopleByPhoneKeys: vi.fn(),
    listPeopleByEmail: vi.fn(),
    listCompanyCandidates: vi.fn(),
    findSdCustomer: vi.fn(),
    listSdCustomersForCompany: vi.fn(),
    findSdContact: vi.fn(),
    listSdContactsForPerson: vi.fn(),
    listSdContacts: vi.fn(),
    findWhatsAppContact: vi.fn(),
    listWhatsAppContacts: vi.fn(),
    setLink: vi.fn(),
  },
}))
vi.mock('../authz')
vi.mock('../sd-access')
vi.mock('@/lib/axiom/audit')

import { CustomerLinkRepository } from '@/src/repositories/customer-link.repository'
import { assertModuleMember } from '../authz'
import { CustomerLinkService as Service } from '../customer-link.service'
import { SdAccess } from '../sd-access'

const repo = vi.mocked(CustomerLinkRepository)
const member = vi.mocked(assertModuleMember)
const sd = vi.mocked(SdAccess)

const company = { id: 'co1', name: 'Acme', cnpj: '12.345.678/0001-90' }
const person = {
  id: 'p1',
  name: 'Ana',
  companyId: 'co1',
  emails: ['ana@acme.com'],
  phones: ['11988887777'],
}
const customer = {
  id: 'c1',
  name: 'Acme SD',
  document: '12345678000190',
  crmCompanyId: null as string | null,
}
const contact = {
  id: 'k1',
  name: 'Ana SD',
  email: 'ana@acme.com',
  phone: null,
  whatsapp: '11988887777',
  crmPersonId: null as string | null,
}
const wa = {
  id: 'w1',
  name: null,
  waId: '5511988887777',
  crmPersonId: null as string | null,
}

beforeEach(() => {
  vi.resetAllMocks()
  member.mockResolvedValue(ok({} as never))
  sd.requireAgent.mockResolvedValue(ok({} as never))
  repo.setLink.mockResolvedValue(ok(true))
})

describe('resolve()', () => {
  beforeEach(() => {
    repo.findCompany.mockResolvedValue(ok(company))
    repo.findPerson.mockResolvedValue(ok(person))
    repo.listSdCustomersForCompany.mockResolvedValue(
      ok([{ ...customer, crmCompanyId: 'co1' }, customer]),
    )
    repo.listSdContactsForPerson.mockResolvedValue(
      ok([{ ...contact, crmPersonId: 'p1' }, contact]),
    )
    repo.listWhatsAppContacts.mockResolvedValue(
      ok([{ ...wa, crmPersonId: 'p1' }, wa]),
    )
  })

  it('resolves a company with stored links first and the fallback after', async () => {
    const out = expectOk(
      await Service.resolve({ workspaceId: 'w', companyId: 'co1' }),
    )
    expect(out.company?.origin).toBe('link')
    expect(out.sdCustomers.map((c) => c.origin)).toEqual(['link', 'fallback'])
    expect(out.person).toBeNull()
  })

  it('resolves by cnpj', async () => {
    repo.findCompanyByCnpj.mockResolvedValue(ok(company))
    const out = expectOk(
      await Service.resolve({ workspaceId: 'w', cnpj: '12345678000190' }),
    )
    expect(out.company?.id).toBe('co1')
  })

  it('resolves a person with company, contacts and whatsapp', async () => {
    const out = expectOk(
      await Service.resolve({ workspaceId: 'w', personId: 'p1' }),
    )
    expect(out.person?.origin).toBe('link')
    expect(out.company?.id).toBe('co1')
    expect(out.sdContacts.map((c) => c.origin)).toEqual(['link', 'fallback'])
    expect(out.whatsappContacts.map((c) => c.origin)).toEqual([
      'link',
      'fallback',
    ])
  })

  it('returns empty when the person does not exist', async () => {
    repo.findPerson.mockResolvedValue(ok(null))
    const out = expectOk(
      await Service.resolve({ workspaceId: 'w', personId: 'x' }),
    )
    expect(out.person).toBeNull()
    expect(out.sdContacts).toEqual([])
  })

  it('resolves a phone to the person, or to bare contacts without one', async () => {
    repo.listPeopleByPhoneKeys.mockResolvedValue(ok([person]))
    const withPerson = expectOk(
      await Service.resolve({ workspaceId: 'w', phone: '+55 11 98888-7777' }),
    )
    expect(withPerson.person?.origin).toBe('fallback')

    repo.listPeopleByPhoneKeys.mockResolvedValue(ok([]))
    repo.listSdContacts.mockResolvedValue(ok([contact]))
    const bare = expectOk(
      await Service.resolve({ workspaceId: 'w', phone: '11988887777' }),
    )
    expect(bare.person).toBeNull()
    expect(bare.sdContacts[0].origin).toBe('fallback')
    expect(repo.listSdContacts).toHaveBeenCalledWith('w', {
      personId: null,
      emails: [],
      keys: ['1188887777'],
    })
  })

  it('resolves an invalid phone without searching people', async () => {
    repo.listPeopleByPhoneKeys.mockResolvedValue(ok([]))
    repo.listSdContacts.mockResolvedValue(ok([]))
    expectOk(await Service.resolve({ workspaceId: 'w', phone: '123' }))
    expect(repo.listPeopleByPhoneKeys).toHaveBeenCalledWith('w', [], 1)
  })

  it('resolves an sd customer through its stored link, its cnpj, or alone', async () => {
    repo.findSdCustomer.mockResolvedValue(
      ok({ ...customer, crmCompanyId: 'co1' }),
    )
    const linked = expectOk(
      await Service.resolve({ workspaceId: 'w', sdCustomerId: 'c1' }),
    )
    expect(linked.company?.origin).toBe('link')

    repo.findSdCustomer.mockResolvedValue(ok(customer))
    repo.findCompanyByCnpj.mockResolvedValue(ok(company))
    expectOk(await Service.resolve({ workspaceId: 'w', sdCustomerId: 'c1' }))
    expect(repo.findCompanyByCnpj).toHaveBeenCalledWith('w', '12345678000190')

    repo.findSdCustomer.mockResolvedValue(ok({ ...customer, document: null }))
    const alone = expectOk(
      await Service.resolve({ workspaceId: 'w', sdCustomerId: 'c1' }),
    )
    expect(alone.company).toBeNull()
    expect(alone.sdCustomers.map((c) => c.id)).toEqual(['c1'])

    repo.findSdCustomer.mockResolvedValue(ok(null))
    expect(
      expectOk(await Service.resolve({ workspaceId: 'w', sdCustomerId: 'x' }))
        .sdCustomers,
    ).toEqual([])
  })

  it('propagates database errors from every step', async () => {
    const boom = err(databaseError('x'))
    repo.findCompany.mockResolvedValueOnce(boom)
    expectErr(
      await Service.resolve({ workspaceId: 'w', companyId: 'co1' }),
      'DATABASE_ERROR',
    )
    repo.findCompanyByCnpj.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', cnpj: '1' }))
    repo.findPerson.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', personId: 'p1' }))
    repo.listPeopleByPhoneKeys.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', phone: '1' }))
    repo.findSdCustomer.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', sdCustomerId: 'c' }))
    repo.listSdCustomersForCompany.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', companyId: 'co1' }))
    repo.listSdContactsForPerson.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', personId: 'p1' }))
    repo.listWhatsAppContacts.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', personId: 'p1' }))
    repo.findCompany.mockResolvedValueOnce(ok(company))
    repo.findSdCustomer.mockResolvedValueOnce(
      ok({ ...customer, crmCompanyId: 'co1' }),
    )
    repo.findCompany.mockReset()
    repo.findCompany.mockResolvedValueOnce(boom)
    expectErr(await Service.resolve({ workspaceId: 'w', sdCustomerId: 'c' }))
  })

  it('looks up the company of a person when only the person is known', async () => {
    repo.findPerson.mockResolvedValue(ok(person))
    repo.findCompany.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.resolve({ workspaceId: 'w', personId: 'p1' }))
  })
})

describe('resolveForActor()', () => {
  beforeEach(() => {
    repo.findCompany.mockResolvedValue(ok(company))
    repo.listSdCustomersForCompany.mockResolvedValue(ok([customer]))
  })

  it('denies actors without CRM access', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.resolveForActor('u', { workspaceId: 'w', companyId: 'c' }),
      'FORBIDDEN',
    )
  })

  it('hides the SD and WhatsApp parts the actor cannot see', async () => {
    sd.requireAgent.mockResolvedValue(err(forbidden()))
    member.mockResolvedValueOnce(ok({} as never))
    member.mockResolvedValueOnce(err(forbidden()))
    const out = expectOk(
      await Service.resolveForActor('u', { workspaceId: 'w', companyId: 'c' }),
    )
    expect(out.company?.id).toBe('co1')
    expect(out.sdCustomers).toEqual([])
    expect(repo.listSdCustomersForCompany).not.toHaveBeenCalled()
  })

  it('includes the parts the actor can see', async () => {
    const out = expectOk(
      await Service.resolveForActor('u', { workspaceId: 'w', companyId: 'c' }),
    )
    expect(out.sdCustomers).toHaveLength(1)
  })
})

describe('getState()', () => {
  it('shows the company link of an sd customer and suggestions', async () => {
    repo.findSdCustomer.mockResolvedValue(
      ok({ ...customer, crmCompanyId: 'co1' }),
    )
    repo.findCompany.mockResolvedValue(ok(company))
    repo.listCompanyCandidates.mockResolvedValue(
      ok([
        { ...company, byCnpj: true },
        { id: 'co2', name: 'Acme', cnpj: null, byCnpj: false },
      ]),
    )
    const out = expectOk(await Service.getState('u', 'w', 'sd-customer', 'c1'))
    expect(out.linked?.id).toBe('co1')
    expect(out.suggestions).toEqual([
      { id: 'co2', name: 'Acme', detail: null, reason: 'Mesmo nome' },
    ])
  })

  it('suggests by cnpj when the customer has no link', async () => {
    repo.findSdCustomer.mockResolvedValue(ok(customer))
    repo.listCompanyCandidates.mockResolvedValue(
      ok([{ ...company, byCnpj: true }]),
    )
    const out = expectOk(await Service.getState('u', 'w', 'sd-customer', 'c1'))
    expect(out.linked).toBeNull()
    expect(out.suggestions[0].reason).toBe('Mesmo CNPJ')
  })

  it('suggests people for an sd contact by e-mail then phone, without duplicates', async () => {
    repo.findSdContact.mockResolvedValue(ok(contact))
    repo.listPeopleByEmail.mockResolvedValue(ok([person]))
    repo.listPeopleByPhoneKeys.mockResolvedValue(
      ok([person, { ...person, id: 'p2', emails: [], phones: ['1190000'] }]),
    )
    const out = expectOk(await Service.getState('u', 'w', 'sd-contact', 'k1'))
    expect(out.suggestions.map((s) => [s.id, s.reason])).toEqual([
      ['p1', 'Mesmo e-mail'],
      ['p2', 'Mesmo telefone'],
    ])
  })

  it('shows the linked person of a whatsapp contact and hides it from the suggestions', async () => {
    repo.findWhatsAppContact.mockResolvedValue(
      ok({ ...wa, name: 'Ana', crmPersonId: 'p1' }),
    )
    repo.findPerson.mockResolvedValue(ok(person))
    repo.listPeopleByPhoneKeys.mockResolvedValue(ok([person]))
    const out = expectOk(
      await Service.getState('u', 'w', 'whatsapp-contact', 'w1'),
    )
    expect(out.sourceName).toBe('Ana')
    expect(out.linked?.name).toBe('Ana')
    expect(out.suggestions).toEqual([])
  })

  it('uses the wa id as name and ignores non numeric ids', async () => {
    repo.findWhatsAppContact.mockResolvedValue(
      ok({ ...wa, waId: 'BR.123', crmPersonId: null }),
    )
    repo.listPeopleByPhoneKeys.mockResolvedValue(ok([]))
    const out = expectOk(
      await Service.getState('u', 'w', 'whatsapp-contact', 'w1'),
    )
    expect(out.sourceName).toBe('BR.123')
    expect(repo.listPeopleByPhoneKeys).toHaveBeenCalledWith('w', [])
  })

  it('404s when the source is missing, for each kind', async () => {
    repo.findSdCustomer.mockResolvedValue(ok(null))
    repo.findSdContact.mockResolvedValue(ok(null))
    repo.findWhatsAppContact.mockResolvedValue(ok(null))
    for (const kind of [
      'sd-customer',
      'sd-contact',
      'whatsapp-contact',
    ] as const) {
      expectErr(
        await Service.getState('u', 'w', kind, 'x'),
        'CUSTOMER_LINK_SOURCE_NOT_FOUND',
      )
    }
  })

  it('denies actors without access, for each module', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.getState('u', 'w', 'sd-customer', 'c'), 'FORBIDDEN')
    member.mockResolvedValueOnce(ok({} as never))
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.getState('u', 'w', 'whatsapp-contact', 'c'),
      'FORBIDDEN',
    )
    sd.requireAgent.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.getState('u', 'w', 'sd-contact', 'c'), 'FORBIDDEN')
  })

  it('propagates database errors', async () => {
    const boom = err(databaseError('x'))
    repo.findSdCustomer.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-customer', 'c'))
    repo.findSdCustomer.mockResolvedValue(
      ok({ ...customer, crmCompanyId: 'co1' }),
    )
    repo.findCompany.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-customer', 'c'))
    repo.findCompany.mockResolvedValue(ok(company))
    repo.listCompanyCandidates.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-customer', 'c'))

    repo.findSdContact.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-contact', 'k'))
    repo.findWhatsAppContact.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'whatsapp-contact', 'k'))
    repo.findSdContact.mockResolvedValue(ok({ ...contact, crmPersonId: 'p1' }))
    repo.findPerson.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-contact', 'k'))
    repo.findPerson.mockResolvedValue(ok(person))
    repo.listPeopleByEmail.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-contact', 'k'))
    repo.listPeopleByEmail.mockResolvedValue(ok([]))
    repo.listPeopleByPhoneKeys.mockResolvedValueOnce(boom)
    expectErr(await Service.getState('u', 'w', 'sd-contact', 'k'))
  })
})

describe('link() / unlink()', () => {
  it('links an sd customer to a company', async () => {
    repo.findSdCustomer.mockResolvedValue(ok(customer))
    repo.findCompany.mockResolvedValue(ok(company))
    expectOk(
      await Service.link('u', 'w', {
        kind: 'sd-customer',
        id: 'c1',
        targetId: 'co1',
      }),
    )
    expect(repo.setLink).toHaveBeenCalledWith('w', 'sd-customer', 'c1', 'co1')
  })

  it('links contacts to a person, for both module kinds', async () => {
    repo.findSdContact.mockResolvedValue(ok(contact))
    repo.findWhatsAppContact.mockResolvedValue(ok(wa))
    repo.findPerson.mockResolvedValue(ok(person))
    for (const [kind, id] of [
      ['sd-contact', 'k1'],
      ['whatsapp-contact', 'w1'],
    ] as const) {
      expectOk(await Service.link('u', 'w', { kind, id, targetId: 'p1' }))
    }
    expect(repo.setLink).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing source or target', async () => {
    repo.findSdCustomer.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.link('u', 'w', {
        kind: 'sd-customer',
        id: 'x',
        targetId: 'co1',
      }),
      'CUSTOMER_LINK_SOURCE_NOT_FOUND',
    )
    repo.findSdCustomer.mockResolvedValue(ok(customer))
    repo.findCompany.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.link('u', 'w', {
        kind: 'sd-customer',
        id: 'c1',
        targetId: 'other-workspace',
      }),
      'CUSTOMER_LINK_TARGET_NOT_FOUND',
    )
    expect(repo.setLink).not.toHaveBeenCalled()
  })

  it('denies actors without edit access', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.link('u', 'w', {
        kind: 'sd-customer',
        id: 'c1',
        targetId: 'co1',
      }),
      'FORBIDDEN',
    )
  })

  it('unlinks without checking a target', async () => {
    repo.findSdContact.mockResolvedValue(ok(contact))
    expectOk(await Service.unlink('u', 'w', { kind: 'sd-contact', id: 'k1' }))
    expect(repo.setLink).toHaveBeenCalledWith('w', 'sd-contact', 'k1', null)
    expect(repo.findPerson).not.toHaveBeenCalled()
  })

  it('propagates repository errors on lookups and on save', async () => {
    const boom = err(databaseError('x'))
    repo.findSdCustomer.mockResolvedValueOnce(boom)
    expectErr(await Service.unlink('u', 'w', { kind: 'sd-customer', id: 'c' }))
    repo.findSdCustomer.mockResolvedValue(ok(customer))
    repo.findCompany.mockResolvedValueOnce(boom)
    expectErr(
      await Service.link('u', 'w', {
        kind: 'sd-customer',
        id: 'c',
        targetId: 'co1',
      }),
    )
    repo.setLink.mockResolvedValueOnce(boom)
    expectErr(
      await Service.unlink('u', 'w', { kind: 'sd-customer', id: 'c' }),
      'DATABASE_ERROR',
    )
  })
})
