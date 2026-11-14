import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { seedSdContact } from '@/src/__tests__/factories/sd-contact.factory'
import { seedSdCustomer } from '@/src/__tests__/factories/sd-customer.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  digitsOnly,
  phoneKeys,
  CustomerLinkRepository as Repo,
} from '../customer-link.repository'

async function base() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { ws: workspace.id, user: user.id }
}

describe('helpers', () => {
  it('keeps only digits', () => {
    expect(digitsOnly('12.345.678/0001-90')).toBe('12345678000190')
    expect(digitsOnly(null)).toBe('')
  })

  it('builds unique phone keys and drops invalid phones', () => {
    expect(
      phoneKeys(['+55 (11) 98888-7777', '11 98888-7777', null, '123']),
    ).toEqual(['1188887777'])
  })
})

describe('CustomerLinkRepository', () => {
  it('finds companies and people scoped by workspace', async () => {
    const { ws, user } = await base()
    const other = await seedWorkspace()
    const company = await seedCrmCompany(ws, user, {
      name: 'Acme',
      cnpj: '12.345.678/0001-90',
    })
    const person = await seedCrmPerson(ws, user, { name: 'Ana' })

    expect(expectOk(await Repo.findCompany(ws, company.id))?.id).toBe(
      company.id,
    )
    expect(expectOk(await Repo.findCompany(other.id, company.id))).toBeNull()
    expect(expectOk(await Repo.findPerson(ws, person.id))?.name).toBe('Ana')
    expect(
      expectOk(await Repo.findCompanyByCnpj(ws, '12345678000190'))?.id,
    ).toBe(company.id)
    expect(expectOk(await Repo.findCompanyByCnpj(ws, '123'))).toBeNull()
  })

  it('lists company candidates by cnpj and by name', async () => {
    const { ws, user } = await base()
    const byCnpj = await seedCrmCompany(ws, user, {
      name: 'Outra',
      cnpj: '12.345.678/0001-90',
    })
    const byName = await seedCrmCompany(ws, user, { name: 'Acme Ltda' })

    const rows = expectOk(
      await Repo.listCompanyCandidates(ws, {
        document: '12345678000190',
        name: 'acme ltda',
      }),
    )
    expect(rows.map((r) => [r.id, r.byCnpj])).toEqual([
      [byCnpj.id, true],
      [byName.id, false],
    ])
  })

  it('lists people by e-mail and by phone key', async () => {
    const { ws, user } = await base()
    const person = await seedCrmPerson(ws, user, {
      emails: ['Ana@Acme.com'],
      phones: ['(11) 98888-7777'],
    })

    expect(
      expectOk(await Repo.listPeopleByEmail(ws, 'ana@acme.com')).map(
        (p) => p.id,
      ),
    ).toEqual([person.id])
    expect(
      expectOk(await Repo.listPeopleByPhoneKeys(ws, ['1188887777'])).map(
        (p) => p.id,
      ),
    ).toEqual([person.id])
    expect(expectOk(await Repo.listPeopleByPhoneKeys(ws, []))).toEqual([])
  })

  it('lists customers linked or matching by cnpj / name, never the linked ones elsewhere', async () => {
    const { ws, user } = await base()
    const company = await seedCrmCompany(ws, user, {
      name: 'Acme',
      cnpj: '12.345.678/0001-90',
    })
    const other = await seedCrmCompany(ws, user, { name: 'Zeta' })
    const linked = await seedSdCustomer(ws, user, {
      name: 'Qualquer',
      crmCompanyId: company.id,
    })
    const byDoc = await seedSdCustomer(ws, user, {
      name: 'Doc',
      document: '12345678000190',
    })
    const byName = await seedSdCustomer(ws, user, { name: 'ACME' })
    await seedSdCustomer(ws, user, {
      name: 'Acme',
      crmCompanyId: other.id,
    })

    const rows = expectOk(await Repo.listSdCustomersForCompany(ws, company))
    expect(rows.map((r) => r.id).sort()).toEqual(
      [linked.id, byDoc.id, byName.id].sort(),
    )
    expect(
      expectOk(await Repo.findSdCustomer(ws, linked.id))?.crmCompanyId,
    ).toBe(company.id)
  })

  it('lists contacts linked or matching by e-mail / phone, skipping linked ones', async () => {
    const { ws, user } = await base()
    const person = await seedCrmPerson(ws, user, {
      emails: ['ana@acme.com'],
      phones: ['+55 11 98888-7777'],
    })
    const other = await seedCrmPerson(ws, user)
    const linked = await seedSdContact(ws, user, { crmPersonId: person.id })
    const byMail = await seedSdContact(ws, user, { email: 'ANA@acme.com' })
    const byPhone = await seedSdContact(ws, user, { whatsapp: '11988887777' })
    await seedSdContact(ws, user, {
      email: 'ana@acme.com',
      crmPersonId: other.id,
    })

    const rows = expectOk(
      await Repo.listSdContactsForPerson(ws, {
        id: person.id,
        name: person.name,
        companyId: null,
        emails: person.emails,
        phones: person.phones,
      }),
    )
    expect(rows.map((r) => r.id).sort()).toEqual(
      [linked.id, byMail.id, byPhone.id].sort(),
    )
    expect(
      expectOk(
        await Repo.listSdContacts(ws, { personId: null, emails: [], keys: [] }),
      ),
    ).toEqual([])
    expect(expectOk(await Repo.findSdContact(ws, linked.id))?.crmPersonId).toBe(
      person.id,
    )
  })

  it('lists whatsapp contacts linked or by wa id, and sets / clears links', async () => {
    const { ws, user } = await base()
    const person = await seedCrmPerson(ws, user, { phones: ['11988887777'] })
    const byId = await prisma.whatsAppContact.create({
      data: { workspaceId: ws, waId: '5511988887777' },
    })
    const linked = await prisma.whatsAppContact.create({
      data: { workspaceId: ws, waId: '5521977776666', crmPersonId: person.id },
    })

    const rows = expectOk(
      await Repo.listWhatsAppContacts(ws, {
        personId: person.id,
        phones: person.phones,
      }),
    )
    expect(rows.map((r) => r.id).sort()).toEqual([byId.id, linked.id].sort())
    expect(
      expectOk(
        await Repo.listWhatsAppContacts(ws, { personId: null, phones: [] }),
      ),
    ).toEqual([])
    expect(expectOk(await Repo.findWhatsAppContact(ws, byId.id))?.waId).toBe(
      '5511988887777',
    )

    expectOk(await Repo.setLink(ws, 'whatsapp-contact', byId.id, person.id))
    expect(
      (await prisma.whatsAppContact.findUnique({ where: { id: byId.id } }))
        ?.crmPersonId,
    ).toBe(person.id)
    expectOk(await Repo.setLink(ws, 'whatsapp-contact', byId.id, null))

    const company = await seedCrmCompany(ws, user)
    const customer = await seedSdCustomer(ws, user)
    expectOk(await Repo.setLink(ws, 'sd-customer', customer.id, company.id))
    const contact = await seedSdContact(ws, user)
    expectOk(await Repo.setLink(ws, 'sd-contact', contact.id, person.id))
    expect(
      (await prisma.sdContact.findUnique({ where: { id: contact.id } }))
        ?.crmPersonId,
    ).toBe(person.id)
  })

  it('returns database errors as err()', async () => {
    const spy = vi
      .spyOn(prisma.crmCompany, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await Repo.findCompany('w', 'c'), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
