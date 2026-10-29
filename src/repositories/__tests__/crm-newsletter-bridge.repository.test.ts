import { describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmLeadRepository } from '../crm-lead.repository'
import { CrmNewsletterBridgeRepository as Repo } from '../crm-newsletter-bridge.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

describe('CrmNewsletterBridgeRepository', () => {
  it('loads the subscriber with its newsletter and the issue', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const subscriber = await seedNewsletterSubscriber(newsletter, 'ana@x.com')
    const issue = await seedNewsletterIssue(newsletter, userId, { number: 2 })

    expect(expectOk(await Repo.findSubscriber(subscriber.id))).toMatchObject({
      id: subscriber.id,
      email: 'ana@x.com',
      status: 'ACTIVE',
      newsletter: { id: newsletter.id, name: 'Novidades' },
    })
    expect(expectOk(await Repo.findSubscriber('missing'))).toBeNull()
    expect(expectOk(await Repo.findIssue(issue.id))).toEqual({
      id: issue.id,
      subject: 'Edição de teste',
      number: 2,
    })
    expect(expectOk(await Repo.findIssue('missing'))).toBeNull()
  })

  it('matches the oldest live person by e-mail, ignoring case and spaces', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    await seedCrmPerson(workspaceId, userId, {
      emails: ['ana@x.com'],
      deletedAt: NOW,
    })
    const person = await seedCrmPerson(workspaceId, userId, {
      emails: [' Ana@X.com '],
    })
    await seedCrmPerson(workspaceId, userId, { emails: ['ana@x.com'] })

    expect(
      expectOk(await Repo.findPersonIdByEmail(workspaceId, 'ANA@x.com')),
    ).toBe(person.id)
    expect(
      expectOk(await Repo.findPersonIdByEmail(workspaceId, 'bia@x.com')),
    ).toBeNull()
  })

  it('finds a timeline entry only for the same event and record', async () => {
    const { workspaceId } = await seedNewsletterScope()
    await prisma.crmActivity.create({
      data: {
        workspaceId,
        action: 'NEWSLETTER_ISSUE_OPENED',
        entity: 'newsletter_issue',
        entityId: 'is1',
        personId: 'p1',
      },
    })
    const base = { workspaceId, personId: 'p1', entityId: 'is1' }
    expect(
      expectOk(
        await Repo.hasActivity({ ...base, action: 'NEWSLETTER_ISSUE_OPENED' }),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await Repo.hasActivity({ ...base, action: 'NEWSLETTER_LINK_CLICKED' }),
      ),
    ).toBe(false)
  })

  it('finds the live leads converted into the person or carrying the e-mail', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const person = await seedCrmPerson(workspaceId, userId)
    const byEmail = await seedCrmLead(workspaceId, userId, {
      emails: ['Ana@X.com'],
    })
    const converted = await seedCrmLead(workspaceId, userId, { emails: [] })
    await prisma.crmLead.update({
      where: { id: converted.id },
      data: { convertedPersonId: person.id },
    })
    await seedCrmLead(workspaceId, userId, {
      emails: ['ana@x.com'],
      deletedAt: NOW,
    })
    await seedCrmLead(workspaceId, userId, { emails: ['bia@x.com'] })

    const both = expectOk(
      await Repo.findLinkedLeadIds(workspaceId, person.id, 'ana@x.com'),
    )
    expect(both.sort()).toEqual([byEmail.id, converted.id].sort())
    expect(
      expectOk(await Repo.findLinkedLeadIds(workspaceId, null, 'ana@x.com')),
    ).toEqual([byEmail.id])
  })

  it('awards points once per rule × lead × event and keeps them on recompute', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const lead = await seedCrmLead(workspaceId, userId, { score: 10 })
    const award = {
      workspaceId,
      leadId: lead.id,
      ruleId: 'rule1',
      eventKey: 'issue:is1',
      points: 15,
    }

    expect(expectOk(await Repo.awardScoreEvent(award))).toBe(true)
    expect(expectOk(await Repo.awardScoreEvent(award))).toBe(false)
    expect(
      expectOk(await Repo.awardScoreEvent({ ...award, eventKey: 'issue:is2' })),
    ).toBe(true)
    expect(
      expectOk(
        await Repo.awardScoreEvent({ ...award, ruleId: 'zero', points: 0 }),
      ),
    ).toBe(true)
    let stored = await prisma.crmLead.findUniqueOrThrow({
      where: { id: lead.id },
    })
    expect(stored.score).toBe(40)

    // A field-rule recompute writes the field score + the earned points.
    const updated = expectOk(
      await CrmLeadRepository.update(lead.id, { score: 5 }),
    )
    expect(updated.score).toBe(35)
    // Updates without a score leave it alone.
    expectOk(await CrmLeadRepository.update(lead.id, { city: 'SP' }))
    stored = await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(stored.score).toBe(35)
  })

  it('fails the award of a missing lead', async () => {
    const { workspaceId } = await seedNewsletterScope()
    const result = await Repo.awardScoreEvent({
      workspaceId,
      leadId: 'missing',
      ruleId: 'r',
      eventKey: 'k',
      points: 1,
    })
    expect(result.ok).toBe(false)
  })

  it('counts the clicks of a recipient on a URL', async () => {
    const { newsletter, userId, workspaceId } = await seedNewsletterScope()
    const subscriber = await seedNewsletterSubscriber(newsletter, 'ana@x.com')
    const issue = await seedNewsletterIssue(newsletter, userId)
    const recipient = await prisma.crmNewsletterIssueRecipient.create({
      data: {
        issueId: issue.id,
        workspaceId,
        subscriberId: subscriber.id,
        email: 'ana@x.com',
      },
    })
    for (const url of ['https://a', 'https://a', 'https://b']) {
      await prisma.crmNewsletterLinkClick.create({
        data: {
          issueId: issue.id,
          recipientId: recipient.id,
          url,
          clickedAt: NOW,
        },
      })
    }
    expect(expectOk(await Repo.countClicks(recipient.id, 'https://a'))).toBe(2)
    expect(expectOk(await Repo.countClicks(recipient.id, 'https://c'))).toBe(0)
  })

  it('lists the subscriptions of a person and the active newsletters', async () => {
    const scope = await seedNewsletterScope({ name: 'B news' })
    const { workspaceId, userId, newsletter } = scope
    const other = await prisma.crmNewsletter.create({
      data: {
        workspaceId,
        createdById: userId,
        name: 'A news',
        slug: 'a-news',
        fromName: 'Acme',
        fromEmail: 'news@news.acme.com.br',
      },
    })
    const archived = await prisma.crmNewsletter.create({
      data: {
        workspaceId,
        createdById: userId,
        name: 'Arquivada',
        slug: 'arquivada',
        fromName: 'Acme',
        fromEmail: 'news@news.acme.com.br',
        status: 'ARCHIVED',
      },
    })
    const deleted = await prisma.crmNewsletter.create({
      data: {
        workspaceId,
        createdById: userId,
        name: 'Excluída',
        slug: 'excluida',
        fromName: 'Acme',
        fromEmail: 'news@news.acme.com.br',
        deletedAt: NOW,
      },
    })
    const person = await seedCrmPerson(workspaceId, userId, {
      name: 'Ana',
      emails: ['ana@x.com'],
    })
    expect(expectOk(await Repo.findPerson(workspaceId, person.id))).toEqual({
      id: person.id,
      name: 'Ana',
      emails: ['ana@x.com'],
    })
    expect(expectOk(await Repo.findPerson('other-ws', person.id))).toBeNull()
    const linked = await seedNewsletterSubscriber(newsletter, 'zz@x.com')
    await prisma.crmNewsletterSubscriber.update({
      where: { id: linked.id },
      data: { personId: person.id },
    })
    const byEmail = await seedNewsletterSubscriber(other, 'ana@x.com')
    await seedNewsletterSubscriber(archived, 'ana@x.com', 'UNSUBSCRIBED')
    await seedNewsletterSubscriber(deleted, 'ana@x.com')
    await seedNewsletterSubscriber(other, 'bia@x.com')

    const rows = expectOk(
      await Repo.listPersonSubscriptions(workspaceId, person.id, ['ana@x.com']),
    )
    expect(rows.map((r) => r.newsletter.name).sort()).toEqual([
      'A news',
      'Arquivada',
      'B news',
    ])
    expect(
      expectOk(await Repo.listPersonSubscriptions(workspaceId, person.id, [])),
    ).toHaveLength(1)
    expect(
      expectOk(await Repo.listActiveNewsletters(workspaceId)).map(
        (n) => n.name,
      ),
    ).toEqual(['A news', 'B news'])

    expect(
      expectOk(await Repo.findSubscription(workspaceId, byEmail.id)),
    ).toMatchObject({ id: byEmail.id, newsletter: { name: 'A news' } })
    expect(
      expectOk(await Repo.findSubscription('other-ws', byEmail.id)),
    ).toBeNull()
  })

  it('unsubscribes only a subscribed row', async () => {
    const { newsletter } = await seedNewsletterScope()
    const active = await seedNewsletterSubscriber(newsletter, 'ana@x.com')
    const bounced = await seedNewsletterSubscriber(
      newsletter,
      'bia@x.com',
      'BOUNCED',
    )

    expect(expectOk(await Repo.unsubscribe(active.id, 'motivo', NOW))).toBe(
      true,
    )
    expect(
      await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
        where: { id: active.id },
      }),
    ).toMatchObject({
      status: 'UNSUBSCRIBED',
      unsubscribedAt: NOW,
      unsubscribeReason: 'motivo',
    })
    expect(expectOk(await Repo.unsubscribe(active.id, 'x', NOW))).toBe(false)
    expect(expectOk(await Repo.unsubscribe(bounced.id, 'x', NOW))).toBe(false)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'findFirst')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'updateMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmActivity, 'findFirst')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterLinkClick, 'count')
        .mockImplementation(down as never),
      vi.spyOn(prisma.crmPerson, 'findFirst').mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletter, 'findMany')
        .mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.findSubscriber('s'), code)
    expectErr(await Repo.findIssue('i'), code)
    expectErr(await Repo.findPersonIdByEmail('w', 'a@x.com'), code)
    expectErr(
      await Repo.hasActivity({
        workspaceId: 'w',
        personId: 'p',
        action: 'a',
        entityId: 'e',
      }),
      code,
    )
    expectErr(await Repo.findLinkedLeadIds('w', null, 'a@x.com'), code)
    expectErr(
      await Repo.awardScoreEvent({
        workspaceId: 'w',
        leadId: 'l',
        ruleId: 'r',
        eventKey: 'k',
        points: 1,
      }),
      code,
    )
    expectErr(await Repo.countClicks('r', 'u'), code)
    expectErr(await Repo.findPerson('w', 'p'), code)
    expectErr(await Repo.listPersonSubscriptions('w', 'p', []), code)
    expectErr(await Repo.listActiveNewsletters('w'), code)
    expectErr(await Repo.findSubscription('w', 's'), code)
    expectErr(await Repo.unsubscribe('s', 'r', NOW), code)
    for (const spy of spies) spy.mockRestore()
  })
})
