import { describe, expect, it, vi } from 'vitest'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedCrmNewsletter,
  seedCrmNewsletterIssue,
  seedCrmNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterSubscriberRepository as Repo } from '../crm-newsletter-subscriber.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const newsletter = await seedCrmNewsletter(workspace.id, user.id)
  return { workspace, user, newsletter }
}

describe('CrmNewsletterSubscriberRepository', () => {
  it('lists with search, filters and pagination', async () => {
    const { workspace, newsletter } = await setup()
    const ana = await seedCrmNewsletterSubscriber(newsletter.id, workspace.id, {
      email: 'ana@x.com',
      name: 'Ana',
      createdAt: new Date('2026-10-03'),
    })
    await seedCrmNewsletterSubscriber(newsletter.id, workspace.id, {
      email: 'bia@x.com',
      status: 'PENDING',
      source: 'IMPORT',
      createdAt: new Date('2026-10-02'),
    })
    await seedCrmNewsletterSubscriber(newsletter.id, workspace.id, {
      email: 'carlos@y.com',
      name: 'ANAlista',
      createdAt: new Date('2026-10-01'),
    })

    const all = expectOk(
      await Repo.list(newsletter.id, { page: 1, pageSize: 2 }),
    )
    expect(all.total).toBe(3)
    expect(all.items.map((s) => s.email)).toEqual(['ana@x.com', 'bia@x.com'])

    const search = expectOk(
      await Repo.list(newsletter.id, { page: 1, pageSize: 25, search: 'ana' }),
    )
    expect(search.items.map((s) => s.email).sort()).toEqual([
      'ana@x.com',
      'carlos@y.com',
    ])

    const filtered = expectOk(
      await Repo.list(newsletter.id, {
        page: 1,
        pageSize: 25,
        status: 'PENDING',
        source: 'IMPORT',
      }),
    )
    expect(filtered.items.map((s) => s.email)).toEqual(['bia@x.com'])

    const exported = expectOk(await Repo.listAll(newsletter.id))
    expect(exported.map((s) => s.email)).toEqual([
      'carlos@y.com',
      'bia@x.com',
      'ana@x.com',
    ])

    expect(expectOk(await Repo.findById(ana.id, newsletter.id)).id).toBe(ana.id)
    expectErr(
      await Repo.findById(ana.id, 'other'),
      'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
    )
  })

  it('creates, refuses duplicates, bulk-inserts and updates', async () => {
    const { workspace, newsletter } = await setup()
    const base = {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      source: 'MANUAL' as const,
    }
    const created = expectOk(await Repo.create({ ...base, email: 'a@x.com' }))
    expectErr(
      await Repo.create({ ...base, email: 'a@x.com' }),
      'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
    )

    expect(
      expectOk(
        await Repo.createMany([
          { ...base, email: 'a@x.com' },
          { ...base, email: 'b@x.com' },
        ]),
      ),
    ).toBe(1)

    const found = expectOk(
      await Repo.findByEmails(newsletter.id, ['a@x.com', 'b@x.com', 'z@x.com']),
    )
    expect(found.map((s) => s.email).sort()).toEqual(['a@x.com', 'b@x.com'])
    expect(
      expectOk(await Repo.findByEmail(newsletter.id, 'z@x.com')),
    ).toBeNull()

    const updated = expectOk(await Repo.update(created.id, { name: 'Ana' }))
    expect(updated.name).toBe('Ana')
    expect(
      expectOk(
        await Repo.updateMany(
          found.map((s) => s.id),
          { status: 'UNSUBSCRIBED' },
        ),
      ),
    ).toBe(2)

    const withNewsletter = expectOk(await Repo.findWithNewsletter(created.id))
    expect(withNewsletter?.newsletter.workspace.id).toBe(workspace.id)
    expect(expectOk(await Repo.findWithNewsletter('nope'))).toBeNull()

    expectOk(await Repo.delete(created.id))
    expect(
      expectOk(await Repo.findByEmail(newsletter.id, 'a@x.com')),
    ).toBeNull()
  })

  it('lists the subscriptions of one address across newsletters', async () => {
    const { workspace, user, newsletter } = await setup()
    const second = await seedCrmNewsletter(workspace.id, user.id)
    await seedCrmNewsletterSubscriber(newsletter.id, workspace.id, {
      email: 'ana@x.com',
    })
    await seedCrmNewsletterSubscriber(second.id, workspace.id, {
      email: 'ana@x.com',
    })
    const rows = expectOk(
      await Repo.listByWorkspaceEmail(workspace.id, 'ana@x.com'),
    )
    expect(rows).toHaveLength(2)
  })

  it('matches CRM people by e-mail, oldest first, case-insensitive', async () => {
    const { workspace, user } = await setup()
    const oldest = await seedCrmPerson(workspace.id, user.id, {
      emails: [' Ana@X.com '],
    })
    await new Promise((r) => setTimeout(r, 5))
    await seedCrmPerson(workspace.id, user.id, { emails: ['ana@x.com'] })
    await seedCrmPerson(workspace.id, user.id, {
      emails: ['gone@x.com'],
      deletedAt: new Date(),
    })
    const map = expectOk(
      await Repo.personIdsByEmails(workspace.id, ['ana@x.com', 'gone@x.com']),
    )
    expect([...map.entries()]).toEqual([['ana@x.com', oldest.id]])
    expect(expectOk(await Repo.personIdsByEmails(workspace.id, [])).size).toBe(
      0,
    )
  })

  it('marks the issue recipient once and handles the global opt-out', async () => {
    const { workspace, user, newsletter } = await setup()
    const subscriber = await seedCrmNewsletterSubscriber(
      newsletter.id,
      workspace.id,
      { email: 'ana@x.com' },
    )
    const issue = await seedCrmNewsletterIssue(
      newsletter.id,
      workspace.id,
      user.id,
    )
    const recipient = await prisma.crmNewsletterIssueRecipient.create({
      data: {
        issueId: issue.id,
        workspaceId: workspace.id,
        subscriberId: subscriber.id,
        email: subscriber.email,
      },
    })
    const first = new Date('2026-10-28T10:00:00.000Z')
    expectOk(
      await Repo.markRecipientUnsubscribed(recipient.id, subscriber.id, first),
    )
    expectOk(
      await Repo.markRecipientUnsubscribed(
        recipient.id,
        subscriber.id,
        new Date(),
      ),
    )
    const row = await prisma.crmNewsletterIssueRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    })
    expect(row.unsubscribedAt).toEqual(first)

    expect(expectOk(await Repo.isOptedOut(workspace.id, 'ana@x.com'))).toBe(
      false,
    )
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: workspace.id,
        email: 'ana@x.com',
        source: 'PREFERENCES',
      },
    })
    expect(expectOk(await Repo.isOptedOut(workspace.id, 'ana@x.com'))).toBe(
      true,
    )
    expectOk(await Repo.deleteWorkspaceOptOut(workspace.id, 'ana@x.com'))
    expect(expectOk(await Repo.isOptedOut(workspace.id, 'ana@x.com'))).toBe(
      false,
    )
  })

  it.each([
    ['list', 'findMany', () => Repo.list('n', { page: 1, pageSize: 1 })],
    ['listAll', 'findMany', () => Repo.listAll('n')],
    ['findById', 'findFirst', () => Repo.findById('x', 'n')],
    ['findWithNewsletter', 'findUnique', () => Repo.findWithNewsletter('x')],
    ['findByEmail', 'findUnique', () => Repo.findByEmail('n', 'e')],
    ['findByEmails', 'findMany', () => Repo.findByEmails('n', ['e'])],
    [
      'listByWorkspaceEmail',
      'findMany',
      () => Repo.listByWorkspaceEmail('w', 'e'),
    ],
    [
      'create',
      'create',
      () =>
        Repo.create({
          newsletterId: 'n',
          workspaceId: 'w',
          email: 'e',
          source: 'API',
        }),
    ],
    [
      'createMany',
      'createMany',
      () =>
        Repo.createMany([
          { newsletterId: 'n', workspaceId: 'w', email: 'e', source: 'API' },
        ]),
    ],
    ['update', 'update', () => Repo.update('x', {})],
    ['updateMany', 'updateMany', () => Repo.updateMany(['x'], {})],
    ['delete', 'delete', () => Repo.delete('x')],
  ] as const)(
    '%s returns DATABASE_ERROR on failure',
    async (_n, method, call) => {
      vi.spyOn(prisma.crmNewsletterSubscriber, method).mockRejectedValueOnce(
        new Error('x'),
      )
      expectErr(await call(), 'DATABASE_ERROR')
    },
  )

  it('the cross-table helpers return DATABASE_ERROR on failure', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.personIdsByEmails('w', ['e']), 'DATABASE_ERROR')
    vi.spyOn(
      prisma.crmNewsletterIssueRecipient,
      'updateMany',
    ).mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.markRecipientUnsubscribed('r', 's', new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmEmailOptOut, 'deleteMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.deleteWorkspaceOptOut('w', 'e'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmEmailOptOut, 'count').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.isOptedOut('w', 'e'), 'DATABASE_ERROR')
  })
})
