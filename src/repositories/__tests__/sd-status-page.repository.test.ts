import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedSdMajorIncident,
  seedSdStatusPage,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCategory,
  seedSdCustomer,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdStatusPageRepository as Repo } from '../sd-status-page.repository'

// The status tables have no foreign key to the workspace, so the global
// TRUNCATE ... CASCADE does not reach them: clean them here.
afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sd_status_pages, sd_major_incidents CASCADE',
  )
})

const pageInput = (workspaceId: string, slug: string) => ({
  workspaceId,
  name: 'Acme',
  slug,
  description: null,
  customerId: null,
  serviceIds: [],
  published: true,
  allowSubscriptions: true,
  createdById: 'u',
})

const subscriber = (
  workspaceId: string,
  pageId: string,
  address: string,
  confirmed = true,
  channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL',
) => ({
  workspaceId,
  pageId,
  channel,
  address,
  name: null,
  token: `tok-${address}-${Math.random().toString(36).slice(2)}`,
  confirmed,
  addedById: null,
})

describe('SdStatusPageRepository pages', () => {
  it('creates, finds and rejects a duplicated slug', async () => {
    const workspace = await seedWorkspace()
    const created = expectOk(
      await Repo.create(pageInput(workspace.id, 'acme-aaa')),
    )
    expectErr(
      await Repo.create(pageInput(workspace.id, 'acme-aaa')),
      'SD_STATUS_PAGE_SLUG_TAKEN',
    )
    expect(expectOk(await Repo.findById(created.id, workspace.id)).slug).toBe(
      'acme-aaa',
    )
    expectErr(
      await Repo.findById(created.id, 'other'),
      'SD_STATUS_PAGE_NOT_FOUND',
    )
    expect(expectOk(await Repo.findBySlug('acme-aaa'))?.id).toBe(created.id)
    expect(expectOk(await Repo.findBySlug('nope'))).toBeNull()
  })

  it('lists by name, loads many by id, updates and removes', async () => {
    const workspace = await seedWorkspace()
    const b = await seedSdStatusPage(workspace.id, {
      name: 'B',
      slug: 'b-page-1',
    })
    const a = await seedSdStatusPage(workspace.id, {
      name: 'A',
      slug: 'a-page-1',
    })
    expect(expectOk(await Repo.list(workspace.id)).map((p) => p.name)).toEqual([
      'A',
      'B',
    ])
    expect(expectOk(await Repo.findManyByIds(workspace.id, [])).length).toBe(0)
    expect(
      expectOk(await Repo.findManyByIds(workspace.id, [a.id, 'x'])).map(
        (p) => p.id,
      ),
    ).toEqual([a.id])

    const updated = expectOk(
      await Repo.update(a.id, workspace.id, { published: false }),
    )
    expect(updated.published).toBe(false)
    expectErr(
      await Repo.update(a.id, 'other', { published: true }),
      'SD_STATUS_PAGE_NOT_FOUND',
    )
    expectOk(await Repo.remove(b.id, workspace.id))
    expectErr(await Repo.remove(b.id, workspace.id), 'SD_STATUS_PAGE_NOT_FOUND')
  })

  it('counts confirmed subscribers and active incidents per page', async () => {
    const workspace = await seedWorkspace()
    const phase = await seedSdPhase(workspace.id)
    const page = await seedSdStatusPage(workspace.id)
    const empty = await seedSdStatusPage(workspace.id)
    expectOk(
      await Repo.createSubscriber(subscriber(workspace.id, page.id, 'a@x.com')),
    )
    expectOk(
      await Repo.createSubscriber(
        subscriber(workspace.id, page.id, 'b@x.com', false),
      ),
    )
    const t1 = await seedSdTicket(workspace.id, phase.id)
    const t2 = await seedSdTicket(workspace.id, phase.id)
    await seedSdMajorIncident(workspace.id, t1.id, { pageIds: [page.id] })
    await seedSdMajorIncident(workspace.id, t2.id, {
      pageIds: [page.id],
      status: 'RESOLVED',
      resolvedAt: new Date(),
    })

    const counts = expectOk(await Repo.counts([page.id, empty.id]))
    expect(counts.subscribers.get(page.id)).toBe(1)
    expect(counts.active.get(page.id)).toBe(1)
    expect(counts.subscribers.get(empty.id)).toBeUndefined()
    const none = expectOk(await Repo.counts([]))
    expect(none.subscribers.size).toBe(0)
  })

  it('lists the incidents of a page: active plus the recently resolved', async () => {
    const workspace = await seedWorkspace()
    const phase = await seedSdPhase(workspace.id)
    const page = await seedSdStatusPage(workspace.id)
    const tickets = []
    for (let i = 0; i < 4; i++) {
      tickets.push(await seedSdTicket(workspace.id, phase.id))
    }
    const live = await seedSdMajorIncident(workspace.id, tickets[0].id, {
      pageIds: [page.id],
    })
    const fresh = await seedSdMajorIncident(workspace.id, tickets[1].id, {
      pageIds: [page.id],
      status: 'RESOLVED',
      resolvedAt: new Date(),
    })
    await seedSdMajorIncident(workspace.id, tickets[2].id, {
      pageIds: [page.id],
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 40 * 86_400_000),
    })
    await seedSdMajorIncident(workspace.id, tickets[3].id, {})

    const since = new Date(Date.now() - 30 * 86_400_000)
    const rows = expectOk(await Repo.listIncidents(page.id, since))
    expect(rows.map((r) => r.id).sort()).toEqual([live.id, fresh.id].sort())
    expect(rows[0].updates[0]).toMatchObject({
      message: 'Estamos investigando.',
    })
  })

  it('hides unpublished updates from the public rows', async () => {
    const workspace = await seedWorkspace()
    const phase = await seedSdPhase(workspace.id)
    const page = await seedSdStatusPage(workspace.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)
    const incident = await seedSdMajorIncident(workspace.id, ticket.id, {
      pageIds: [page.id],
    })
    await prisma.sdMajorIncidentUpdate.create({
      data: {
        incidentId: incident.id,
        workspaceId: workspace.id,
        status: 'IDENTIFIED',
        message: 'interno',
        publish: false,
      },
    })
    const rows = expectOk(
      await Repo.listIncidents(page.id, new Date(Date.now() - 86_400_000)),
    )
    expect(rows[0].updates.map((u) => u.message)).toEqual([
      'Estamos investigando.',
    ])
  })

  it('resolves the names of services, customers and the workspace', async () => {
    const workspace = await seedWorkspace({ name: 'Stratus' })
    const user = await seedUser()
    const service = await seedSdCategory(workspace.id, { name: 'Telefonia' })
    const customer = await seedSdCustomer(workspace.id, user.id, {
      name: 'Acme',
    })

    const names = expectOk(
      await Repo.findNames(workspace.id, {
        serviceIds: [service.id],
        customerId: customer.id,
      }),
    )
    expect(names.services.get(service.id)).toBe('Telefonia')
    expect(names.customers.get(customer.id)).toBe('Acme')
    const empty = expectOk(
      await Repo.findNames(workspace.id, { serviceIds: [], customerId: null }),
    )
    expect(empty.services.size + empty.customers.size).toBe(0)

    expect(expectOk(await Repo.findWorkspaceName(workspace.id))).toBe('Stratus')
    expect(expectOk(await Repo.findWorkspaceName('nope'))).toBeNull()
  })
})

describe('SdStatusPageRepository subscribers', () => {
  it('creates, finds, confirms and removes a subscriber', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const created = expectOk(
      await Repo.createSubscriber(
        subscriber(workspace.id, page.id, 'ana@x.com', false),
      ),
    )
    expect(created.confirmedAt).toBeNull()
    expect(
      expectOk(await Repo.findSubscriber(page.id, 'EMAIL', 'ana@x.com'))?.id,
    ).toBe(created.id)
    expect(
      expectOk(await Repo.findSubscriber(page.id, 'WHATSAPP', 'ana@x.com')),
    ).toBeNull()
    expect(expectOk(await Repo.findSubscriberByToken(created.token))?.id).toBe(
      created.id,
    )
    expect(expectOk(await Repo.findSubscriberByToken('nope'))).toBeNull()

    const confirmed = expectOk(await Repo.confirmSubscriber(created.id))
    expect(confirmed.confirmedAt).toBeInstanceOf(Date)
    expect(expectOk(await Repo.listSubscribers(page.id))).toHaveLength(1)

    expectOk(await Repo.removeSubscriber(created.id, page.id))
    expectErr(
      await Repo.removeSubscriber(created.id, page.id),
      'SD_STATUS_SUBSCRIBER_NOT_FOUND',
    )
  })

  it('lists confirmed subscribers of several pages without duplicates', async () => {
    const workspace = await seedWorkspace()
    const a = await seedSdStatusPage(workspace.id, {
      name: 'A',
      slug: 'a-sub-1',
    })
    const b = await seedSdStatusPage(workspace.id, {
      name: 'B',
      slug: 'b-sub-1',
    })
    for (const page of [a, b]) {
      expectOk(
        await Repo.createSubscriber(
          subscriber(workspace.id, page.id, 'same@x.com'),
        ),
      )
    }
    expectOk(
      await Repo.createSubscriber(subscriber(workspace.id, a.id, 'only@x.com')),
    )
    expectOk(
      await Repo.createSubscriber(
        subscriber(workspace.id, a.id, '5511999990000', true, 'WHATSAPP'),
      ),
    )
    expectOk(
      await Repo.createSubscriber(
        subscriber(workspace.id, a.id, 'pending@x.com', false),
      ),
    )

    const rows = expectOk(await Repo.listConfirmedForPages([a.id, b.id], 100))
    expect(rows.map((r) => r.address).sort()).toEqual([
      '5511999990000',
      'only@x.com',
      'same@x.com',
    ])
    expect(rows[0].pageSlug).toMatch(/-sub-1$/)
    expect(expectOk(await Repo.listConfirmedForPages([], 10))).toEqual([])
  })

  it('maps every database failure to DATABASE_ERROR', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    const restore = [
      vi.spyOn(prisma.sdStatusPage, 'create').mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusPage, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusPage, 'findUnique')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusPage, 'findMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusPage, 'updateMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusPage, 'deleteMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'groupBy')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentPage, 'groupBy')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncident, 'findMany')
        .mockImplementation(boom as never),
      vi.spyOn(prisma.sdCategory, 'findMany').mockImplementation(boom as never),
      vi.spyOn(prisma.sdCustomer, 'findMany').mockImplementation(boom as never),
      vi
        .spyOn(prisma.workspace, 'findUnique')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'findMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'findUnique')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'create')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'update')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdStatusSubscriber, 'deleteMany')
        .mockImplementation(boom as never),
    ]
    const calls = [
      Repo.create(pageInput('w', 'x-slug')),
      Repo.findById('p', 'w'),
      Repo.findBySlug('s'),
      Repo.list('w'),
      Repo.findManyByIds('w', ['p']),
      Repo.update('p', 'w', { name: 'n' }),
      Repo.remove('p', 'w'),
      Repo.counts(['p']),
      Repo.listIncidents('p', new Date()),
      Repo.findNames('w', { serviceIds: ['s'], customerId: 'c' }),
      Repo.findWorkspaceName('w'),
      Repo.listSubscribers('p'),
      Repo.findSubscriber('p', 'EMAIL', 'a'),
      Repo.findSubscriberByToken('t'),
      Repo.createSubscriber(subscriber('w', 'p', 'a@x.com')),
      Repo.confirmSubscriber('s'),
      Repo.removeSubscriber('s', 'p'),
      Repo.listConfirmedForPages(['p'], 10),
    ]
    for (const result of await Promise.all(calls)) {
      expectErr(result, 'DATABASE_ERROR')
    }
    for (const spy of restore) spy.mockRestore()
  })
})
