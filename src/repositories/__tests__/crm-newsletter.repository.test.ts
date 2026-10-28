import { describe, expect, it, vi } from 'vitest'
import { seedCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import {
  seedCrmNewsletter,
  seedCrmNewsletterIssue,
  seedCrmNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterRepository as Repo } from '../crm-newsletter.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('CrmNewsletterRepository', () => {
  it('creates, finds, lists and updates within the workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const created = expectOk(
      await Repo.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Novidades',
        slug: 'novidades',
        fromName: 'Acme',
        fromEmail: 'news@acme.com',
      }),
    )
    const archived = await seedCrmNewsletter(workspace.id, user.id, {
      status: 'ARCHIVED',
    })
    await seedCrmNewsletter(workspace.id, user.id, { deletedAt: new Date() })

    expect(expectOk(await Repo.findById(created.id, workspace.id)).id).toBe(
      created.id,
    )
    expectErr(
      await Repo.findById(created.id, other.id),
      'CRM_NEWSLETTER_NOT_FOUND',
    )

    const list = expectOk(await Repo.listByWorkspace(workspace.id))
    expect(list.map((n) => n.id)).toEqual([created.id, archived.id])
    const active = expectOk(await Repo.listActiveByWorkspace(workspace.id))
    expect(active.map((n) => n.id)).toEqual([created.id])

    const updated = expectOk(
      await Repo.update(created.id, {
        name: 'Novo nome',
        updatedById: user.id,
      }),
    )
    expect(updated.name).toBe('Novo nome')
  })

  it('maps a duplicate slug to CRM_NEWSLETTER_SLUG_TAKEN', async () => {
    const { workspace, user } = await setup()
    const a = await seedCrmNewsletter(workspace.id, user.id, { slug: 'a' })
    const b = await seedCrmNewsletter(workspace.id, user.id, { slug: 'b' })
    expectErr(
      await Repo.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'x',
        slug: 'a',
        fromName: 'x',
        fromEmail: 'x@x.com',
      }),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
    expectErr(
      await Repo.update(b.id, { slug: 'a' }),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
    expect(expectOk(await Repo.slugExists(workspace.id, 'a'))).toBe(true)
    expect(expectOk(await Repo.slugExists(workspace.id, 'a', a.id))).toBe(false)
  })

  it('finds by public slugs and by id with the workspace', async () => {
    const { workspace, user } = await setup()
    const newsletter = await seedCrmNewsletter(workspace.id, user.id, {
      slug: 'pub',
    })
    const bySlug = expectOk(await Repo.findBySlugs(workspace.slug, 'pub'))
    expect(bySlug?.workspace.slug).toBe(workspace.slug)
    expect(expectOk(await Repo.findBySlugs('nope', 'pub'))).toBeNull()
    const byId = expectOk(await Repo.findWithWorkspace(newsletter.id))
    expect(byId?.workspace.id).toBe(workspace.id)
  })

  it('soft delete frees the slug and unlinks the forms', async () => {
    const { workspace, user } = await setup()
    const newsletter = await seedCrmNewsletter(workspace.id, user.id, {
      slug: 'livre',
    })
    const form = await seedCrmForm(workspace.id, user.id)
    await prisma.crmForm.update({
      where: { id: form.id },
      data: { newsletterId: newsletter.id },
    })

    expectOk(await Repo.softDelete(newsletter.id, new Date()))
    expect(expectOk(await Repo.slugExists(workspace.id, 'livre'))).toBe(false)
    const row = await prisma.crmForm.findUniqueOrThrow({
      where: { id: form.id },
    })
    expect(row.newsletterId).toBeNull()
    expect(expectOk(await Repo.findWithWorkspace(newsletter.id))).toBeNull()
  })

  it('counts subscribers and sent issues per newsletter', async () => {
    const { workspace, user } = await setup()
    const a = await seedCrmNewsletter(workspace.id, user.id)
    const b = await seedCrmNewsletter(workspace.id, user.id)
    await seedCrmNewsletterSubscriber(a.id, workspace.id, { status: 'ACTIVE' })
    await seedCrmNewsletterSubscriber(a.id, workspace.id, { status: 'ACTIVE' })
    await seedCrmNewsletterSubscriber(a.id, workspace.id, { status: 'PENDING' })
    await seedCrmNewsletterSubscriber(a.id, workspace.id, {
      status: 'UNSUBSCRIBED',
    })
    const sentAt = new Date('2026-10-01T12:00:00.000Z')
    await seedCrmNewsletterIssue(a.id, workspace.id, user.id, {
      status: 'SENT',
      sentAt,
      number: 1,
    })
    await seedCrmNewsletterIssue(a.id, workspace.id, user.id, {
      status: 'DRAFT',
    })
    await seedCrmNewsletterSubscriber(b.id, workspace.id, { status: 'PENDING' })

    const stats = expectOk(await Repo.statsFor([a.id, b.id]))
    expect(stats.get(a.id)).toEqual({
      active: 2,
      pending: 1,
      issuesSent: 1,
      lastIssueSentAt: sentAt,
    })
    expect(stats.get(b.id)).toEqual({
      active: 0,
      pending: 1,
      issuesSent: 0,
      lastIssueSentAt: null,
    })
    expect(expectOk(await Repo.statsFor([])).size).toBe(0)
  })

  it.each([
    ['listByWorkspace', 'findMany', () => Repo.listByWorkspace('w')],
    [
      'listActiveByWorkspace',
      'findMany',
      () => Repo.listActiveByWorkspace('w'),
    ],
    ['findById', 'findFirst', () => Repo.findById('x', 'w')],
    ['findWithWorkspace', 'findFirst', () => Repo.findWithWorkspace('x')],
    ['findBySlugs', 'findFirst', () => Repo.findBySlugs('w', 's')],
    ['slugExists', 'count', () => Repo.slugExists('w', 's')],
    ['update', 'update', () => Repo.update('x', { name: 'n' })],
    ['softDelete', 'findUniqueOrThrow', () => Repo.softDelete('x', new Date())],
    [
      'create',
      'create',
      () =>
        Repo.create({
          workspaceId: 'w',
          createdById: 'u',
          name: 'n',
          slug: 's',
          fromName: 'f',
          fromEmail: 'e@e.com',
        }),
    ],
  ] as const)(
    '%s returns DATABASE_ERROR on failure',
    async (_n, method, call) => {
      vi.spyOn(prisma.crmNewsletter, method).mockRejectedValueOnce(
        new Error('x'),
      )
      expectErr(await call(), 'DATABASE_ERROR')
    },
  )

  it('statsFor returns DATABASE_ERROR on failure', async () => {
    vi.spyOn(prisma.crmNewsletterIssue, 'groupBy').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.statsFor(['a']), 'DATABASE_ERROR')
  })
})
