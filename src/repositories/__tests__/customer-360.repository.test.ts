import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  enableModule,
  seedHealthWorkspace,
  seedZapConversation,
} from '@/src/__tests__/factories/nov-health-scores.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdContact,
  seedSdCustomer,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { Customer360Repository as Repo } from '../customer-360.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup() {
  const ctx = await seedHealthWorkspace()
  await enableModule(ctx.workspace.id, ctx.user.id, 'SERVICE_DESK')
  const company = await seedCrmCompany(ctx.workspace.id, ctx.user.id, {
    name: 'Acme',
    cnpj: '11.222.333/0001-81',
  })
  const person = await seedCrmPerson(ctx.workspace.id, ctx.user.id, {
    name: 'Ana',
    emails: ['ana@acme.com'],
    phones: ['(11) 98888-7777'],
    companyId: company.id,
  })
  return { ...ctx, company, person }
}

describe('resolveIdentity', () => {
  it('starts from a person and brings the company and ServiceDesk matches', async () => {
    const { workspace, user, company, person } = await setup()
    const customer = await seedSdCustomer(workspace.id, user.id, {
      name: 'Outro nome',
      document: '11222333000181',
    })
    const contact = await seedSdContact(workspace.id, user.id, {
      email: 'ANA@acme.com',
    })

    const who = expectOk(
      await Repo.resolveIdentity(workspace.id, { personId: person.id }),
    )
    expect(who.match).toBe('person')
    expect(who.person?.id).toBe(person.id)
    expect(who.company?.id).toBe(company.id)
    expect(who.sdCustomerIds).toEqual([customer.id])
    expect(who.sdContactIds).toEqual([contact.id])
    expect(who.phones).toEqual(['(11) 98888-7777'])
    expect(who.emails).toEqual(['ana@acme.com'])
  })

  it('starts from a company', async () => {
    const { workspace, company } = await setup()
    const who = expectOk(
      await Repo.resolveIdentity(workspace.id, { companyId: company.id }),
    )
    expect(who.match).toBe('company')
    expect(who.person).toBeNull()
    expect(who.company?.name).toBe('Acme')
  })

  it('finds the person by a WhatsApp phone, with or without 55 and the ninth digit', async () => {
    const { workspace, person } = await setup()
    for (const phone of ['5511988887777', '551188887777', '11 98888-7777']) {
      const who = expectOk(await Repo.resolveIdentity(workspace.id, { phone }))
      expect(who.person?.id).toBe(person.id)
      expect(who.match).toBe('phone')
    }
  })

  it('keeps an unknown phone as a bare anchor', async () => {
    const { workspace } = await setup()
    const who = expectOk(
      await Repo.resolveIdentity(workspace.id, { phone: '5521977776666' }),
    )
    expect(who.person).toBeNull()
    expect(who.match).toBe('none')
    expect(who.phones).toEqual(['5521977776666'])
    const junk = expectOk(
      await Repo.resolveIdentity(workspace.id, { phone: 'abc' }),
    )
    expect(junk.match).toBe('none')
  })

  it('ignores records of another workspace and deleted ones', async () => {
    const { workspace, user } = await setup()
    const other = await setup()
    const gone = await seedCrmPerson(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    const who = expectOk(
      await Repo.resolveIdentity(workspace.id, {
        personId: other.person.id,
        companyId: other.company.id,
      }),
    )
    expect(who.person).toBeNull()
    expect(who.company).toBeNull()
    const deleted = expectOk(
      await Repo.resolveIdentity(workspace.id, { personId: gone.id }),
    )
    expect(deleted.match).toBe('none')
  })

  it('goes from a ServiceDesk customer to the company by CNPJ, then by exact name', async () => {
    const { workspace, user, company } = await setup()
    const byCnpj = await seedSdCustomer(workspace.id, user.id, {
      name: 'Qualquer',
      document: '11.222.333/0001-81',
    })
    const found = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdCustomerId: byCnpj.id }),
    )
    expect(found.match).toBe('cnpj')
    expect(found.company?.id).toBe(company.id)

    const byName = await seedSdCustomer(workspace.id, user.id, {
      name: 'ACME',
      document: '99999999000191',
    })
    const named = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdCustomerId: byName.id }),
    )
    expect(named.match).toBe('name')
    expect(named.company?.id).toBe(company.id)

    const nobody = await seedSdCustomer(workspace.id, user.id, {
      name: 'Sem par',
    })
    const none = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdCustomerId: nobody.id }),
    )
    expect(none.company).toBeNull()
    expect(none.sdCustomerIds).toEqual([nobody.id])
  })

  it('goes from a ServiceDesk contact to the person by e-mail, then by phone', async () => {
    const { workspace, user, person } = await setup()
    const byEmail = await seedSdContact(workspace.id, user.id, {
      email: 'ANA@Acme.com',
    })
    const viaEmail = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdContactId: byEmail.id }),
    )
    expect(viaEmail.match).toBe('email')
    expect(viaEmail.person?.id).toBe(person.id)

    const byPhone = await seedSdContact(workspace.id, user.id, {
      name: 'Outra',
      whatsapp: '5511988887777',
    })
    const viaPhone = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdContactId: byPhone.id }),
    )
    expect(viaPhone.match).toBe('phone')
    expect(viaPhone.person?.id).toBe(person.id)

    const stranger = await seedSdContact(workspace.id, user.id, {
      name: 'Estranho',
      email: 'x@y.com',
      phone: '12',
    })
    const none = expectOk(
      await Repo.resolveIdentity(workspace.id, { sdContactId: stranger.id }),
    )
    expect(none.person).toBeNull()
    expect(none.emails).toEqual(['x@y.com'])
  })

  it('survives unknown ServiceDesk anchors', async () => {
    const { workspace } = await setup()
    const who = expectOk(
      await Repo.resolveIdentity(workspace.id, {
        sdCustomerId: 'nope',
        sdContactId: 'nope',
      }),
    )
    expect(who.match).toBe('none')
    expect(who.sdCustomerIds).toEqual([])
  })

  it('reports a database failure', async () => {
    vi.spyOn(prisma.crmPerson, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    const error = expectErr(
      await Repo.resolveIdentity('w', { personId: 'p' }),
    )
    expect(error.code).toBe('DATABASE_ERROR')
  })
})

describe('anchors', () => {
  it('reads the customer, contact and conversation of a ticket', async () => {
    const { workspace } = await setup()
    const phase = await seedSdPhase(workspace.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)
    expect(expectOk(await Repo.ticketAnchors(workspace.id, ticket.id))).toEqual(
      { sdCustomerId: undefined, sdContactId: undefined, conversationId: null },
    )
    expect(
      expectOk(await Repo.ticketAnchors(workspace.id, 'missing')),
    ).toBeNull()
  })

  it('prefers the ticket company over its customer', async () => {
    const { workspace, user } = await setup()
    const phase = await seedSdPhase(workspace.id)
    const customer = await seedSdCustomer(workspace.id, user.id)
    const company = await seedSdCustomer(workspace.id, user.id, {
      name: 'Matriz',
    })
    const contact = await seedSdContact(workspace.id, user.id)
    const ticket = await seedSdTicket(workspace.id, phase.id, {
      customerId: customer.id,
      companyId: company.id,
      contactId: contact.id,
    })
    const anchors = expectOk(await Repo.ticketAnchors(workspace.id, ticket.id))
    expect(anchors?.sdCustomerId).toBe(company.id)
    expect(anchors?.sdContactId).toBe(contact.id)
  })

  it('reads the phone of a conversation', async () => {
    const { workspace, user } = await setup()
    const conversation = await seedZapConversation(
      workspace.id,
      user.id,
      '5511988887777',
      {},
    )
    expect(
      expectOk(await Repo.conversationPhone(workspace.id, conversation.id)),
    ).toBe('5511988887777')
    expect(
      expectOk(await Repo.conversationPhone(workspace.id, 'missing')),
    ).toBeNull()
  })

  it('reports database failures of the anchor reads', async () => {
    vi.spyOn(prisma.sdTicket, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.ticketAnchors('w', 't'))
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.conversationPhone('w', 'c'))
  })
})

describe('sections', () => {
  it('lists the deals of the company and of the contact person', async () => {
    const { workspace, user, pipeline, open, company, person } = await setup()
    const byCompany = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { companyId: company.id },
    )
    const byPerson = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { pointOfContactId: person.id },
    )
    const rows = expectOk(
      await Repo.listOpportunities(workspace.id, {
        person: { ...person, accountOwner: null } as never,
        company: { ...company, accountOwner: null } as never,
      }),
    )
    expect(rows.map((row) => row.id).sort()).toEqual(
      [byCompany.id, byPerson.id].sort(),
    )
    expect(rows[0]?.stage.name).toBe('Qualificação')
    expect(
      expectOk(
        await Repo.listOpportunities(workspace.id, {
          person: null,
          company: null,
        }),
      ),
    ).toEqual([])
  })

  it('lists open leads by phone key or e-mail, never converted ones', async () => {
    const { workspace, user, person } = await setup()
    const byPhone = await prisma.crmLead.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Lead telefone',
        phones: ['5511988887777'],
      },
    })
    const byEmail = await prisma.crmLead.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Lead e-mail',
        emails: ['ana@acme.com'],
      },
    })
    await prisma.crmLead.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Convertido',
        phones: ['5511988887777'],
        convertedPersonId: person.id,
      },
    })
    const rows = expectOk(
      await Repo.listLeads(workspace.id, {
        phones: ['(11) 98888-7777', 'abc'],
        emails: ['ana@acme.com'],
      }),
    )
    expect(rows.map((row) => row.id).sort()).toEqual(
      [byPhone.id, byEmail.id].sort(),
    )
    expect(
      expectOk(await Repo.listLeads(workspace.id, { phones: [], emails: [] })),
    ).toEqual([])
  })

  it('lists tickets with the open count and the conversation link', async () => {
    const { workspace, user } = await setup()
    const phase = await seedSdPhase(workspace.id)
    const customer = await seedSdCustomer(workspace.id, user.id)
    const contact = await seedSdContact(workspace.id, user.id)
    const conversation = await seedZapConversation(
      workspace.id,
      user.id,
      '5511911112222',
      {},
    )
    const mine = await seedSdTicket(workspace.id, phase.id, {
      customerId: customer.id,
    })
    await seedSdTicket(workspace.id, phase.id, {
      contactId: contact.id,
      closedAt: new Date(),
      resolvedAt: new Date(),
    })
    const viaChat = await seedSdTicket(workspace.id, phase.id, {
      whatsappConversationId: conversation.id,
    })
    await seedSdTicket(workspace.id, phase.id)

    const result = expectOk(
      await Repo.listTickets(
        workspace.id,
        { sdCustomerIds: [customer.id], sdContactIds: [contact.id] },
        conversation.id,
      ),
    )
    expect(result.rows).toHaveLength(3)
    expect(result.open).toBe(2)
    expect(result.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([mine.id, viaChat.id]),
    )
    expect(
      expectOk(
        await Repo.listTickets(
          workspace.id,
          { sdCustomerIds: [], sdContactIds: [] },
          null,
        ),
      ),
    ).toEqual({ rows: [], open: 0 })
  })

  it('lists conversations by phone variant', async () => {
    const { workspace, user } = await setup()
    await seedZapConversation(workspace.id, user.id, '551188887777', {
      lastMessageAt: new Date(),
    })
    const rows = expectOk(
      await Repo.listConversations(workspace.id, {
        phones: ['(11) 98888-7777'],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.contact.waId).toBe('551188887777')
    expect(
      expectOk(await Repo.listConversations(workspace.id, { phones: ['1'] })),
    ).toEqual([])
  })

  it('lists calls of the person and of the deals', async () => {
    const { workspace, user, pipeline, open, company, person } = await setup()
    const deal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { companyId: company.id },
    )
    const call = (data: Record<string, unknown>) =>
      prisma.whatsAppPhoneCall.create({
        data: {
          workspaceId: workspace.id,
          deviceId: 'd',
          extension: '100',
          destination: '5511988887777',
          callbackTokenHash: `${Math.random()}`.padEnd(64, '0').slice(0, 64),
          ...data,
        },
      })
    const a = await call({ crmPersonId: person.id })
    const b = await call({ crmOpportunityId: deal.id })
    await call({})
    const rows = expectOk(
      await Repo.listCalls(workspace.id, { person }, [deal.id]),
    )
    expect(rows.map((row) => row.id).sort()).toEqual([a.id, b.id].sort())
    expect(
      expectOk(await Repo.listCalls(workspace.id, { person: null }, [])),
    ).toEqual([])
  })

  it('lists the documents of the company, person and deals, not templates', async () => {
    const { workspace, user, pipeline, open, company, person } = await setup()
    const deal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
    )
    const doc = (data: Record<string, unknown>) =>
      prisma.document.create({
        data: {
          workspaceId: workspace.id,
          title: 'Doc',
          content: {},
          publicToken: `${Math.random()}`,
          ownerId: user.id,
          createdById: user.id,
          ...data,
        },
      })
    const a = await doc({ companyId: company.id })
    const b = await doc({ personId: person.id })
    const c = await doc({ opportunityId: deal.id })
    await doc({ companyId: company.id, isTemplate: true })
    const rows = expectOk(
      await Repo.listDocuments(
        workspace.id,
        { person, company } as never,
        [deal.id],
      ),
    )
    expect(rows.map((row) => row.id).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(
      expectOk(
        await Repo.listDocuments(
          workspace.id,
          { person: null, company: null },
          [],
        ),
      ),
    ).toEqual([])
  })

  it('reads the stored health of a company', async () => {
    const { workspace, company } = await setup()
    expect(expectOk(await Repo.getHealth(workspace.id, company.id))).toBeNull()
    await prisma.crmCustomerHealth.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        riskScore: 80,
        level: 'HIGH',
        nextAction: {},
      },
    })
    expect(
      expectOk(await Repo.getHealth(workspace.id, company.id))?.riskScore,
    ).toBe(80)
  })

  it('reports database failures of the section reads', async () => {
    const who = { person: null, company: { id: 'c' } } as never
    vi.spyOn(prisma.crmOpportunity, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.listOpportunities('w', who))
    vi.spyOn(prisma.crmLead, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.listLeads('w', { phones: [], emails: ['a@b.c'] }))
    vi.spyOn(prisma.sdTicket, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.listTickets('w', { sdCustomerIds: ['a'], sdContactIds: [] }, null),
    )
    vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.listConversations('w', { phones: ['11988887777'] }))
    vi.spyOn(prisma.whatsAppPhoneCall, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.listCalls('w', { person: null }, ['d']))
    vi.spyOn(prisma.document, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.listDocuments('w', who, []))
    vi.spyOn(prisma.crmCustomerHealth, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.getHealth('w', 'c'))
  })
})

describe('phoneTargets', () => {
  it('uses the person phones', async () => {
    const { workspace, person } = await setup()
    const target = expectOk(
      await Repo.phoneTargets(workspace.id, { personId: person.id }),
    )
    expect(target).toMatchObject({ name: 'Ana', phones: ['(11) 98888-7777'] })
  })

  it('uses the point of contact of a deal', async () => {
    const { workspace, user, pipeline, open, person } = await setup()
    const deal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { pointOfContactId: person.id },
    )
    const target = expectOk(
      await Repo.phoneTargets(workspace.id, { opportunityId: deal.id }),
    )
    expect(target?.name).toBe('Ana')
  })

  it('falls back to the first contact of the company with a phone', async () => {
    const { workspace, user, company } = await setup()
    const empty = await seedCrmCompany(workspace.id, user.id, { name: 'Vazia' })
    const target = expectOk(
      await Repo.phoneTargets(workspace.id, { companyId: company.id }),
    )
    expect(target?.name).toBe('Ana')
    expect(
      expectOk(await Repo.phoneTargets(workspace.id, { companyId: empty.id })),
    ).toEqual({ name: 'Vazia', phones: [] })
    expect(
      expectOk(await Repo.phoneTargets(workspace.id, { companyId: 'nope' })),
    ).toBeNull()
  })

  it('falls back to the company when the contact has no phone', async () => {
    const { workspace, user, pipeline, open, company } = await setup()
    const mute = await seedCrmPerson(workspace.id, user.id, { name: 'Mudo' })
    const deal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { companyId: company.id, pointOfContactId: mute.id },
    )
    const target = expectOk(
      await Repo.phoneTargets(workspace.id, { opportunityId: deal.id }),
    )
    expect(target?.name).toBe('Ana')
    expect(
      expectOk(await Repo.phoneTargets(workspace.id, { personId: mute.id })),
    ).toEqual({ name: 'Mudo', phones: [] })
  })

  it('returns null for unknown records', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(await Repo.phoneTargets(workspace.id, { personId: 'nope' })),
    ).toBeNull()
    expect(
      expectOk(
        await Repo.phoneTargets(workspace.id, { opportunityId: 'nope' }),
      ),
    ).toBeNull()
    expect(expectOk(await Repo.phoneTargets(workspace.id, {}))).toBeNull()
  })

  it('reports a database failure', async () => {
    vi.spyOn(prisma.crmPerson, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.phoneTargets('w', { personId: 'p' }))
  })
})
