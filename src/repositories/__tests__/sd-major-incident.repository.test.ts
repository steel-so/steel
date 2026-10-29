import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedSdMajorIncident,
  seedSdStatusPage,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCategory,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdMajorIncidentRepository as Repo } from '../sd-major-incident.repository'

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sd_status_pages, sd_major_incidents CASCADE',
  )
})

async function setup() {
  const [workspace, agent] = await Promise.all([seedWorkspace(), seedUser()])
  const phase = await seedSdPhase(workspace.id)
  const open = await seedSdPhase(workspace.id, {
    name: 'Em andamento',
    category: 'IN_PROGRESS',
  })
  const resolved = await seedSdPhase(workspace.id, {
    name: 'Resolvido',
    category: 'RESOLVED',
  })
  const master = await seedSdTicket(workspace.id, phase.id)
  const child = await seedSdTicket(workspace.id, open.id)
  return { workspace, agent, phase, open, resolved, master, child }
}

describe('SdMajorIncidentRepository', () => {
  it('creates with pages, children and the first update', async () => {
    const { workspace, agent, master, child } = await setup()
    const page = await seedSdStatusPage(workspace.id)
    const created = expectOk(
      await Repo.create({
        workspaceId: workspace.id,
        ticketId: master.id,
        title: 'Telefonia fora',
        summary: null,
        impact: 'MAJOR_OUTAGE',
        commanderId: agent.id,
        declaredById: agent.id,
        pageIds: [page.id],
        children: [{ ticketId: child.id, source: 'MANUAL' }],
        firstUpdate: { message: 'Investigando', publish: true },
      }),
    )
    expect(created.status).toBe('INVESTIGATING')
    expect(created.updates).toHaveLength(1)
    expect(created.links[0].ticket.phase.category).toBe('IN_PROGRESS')
    expect(created.pages[0].page.slug).toBe(page.slug)

    expect(expectOk(await Repo.findById(created.id, workspace.id)).title).toBe(
      'Telefonia fora',
    )
    expectErr(
      await Repo.findById(created.id, 'other-ws'),
      'SD_MAJOR_INCIDENT_NOT_FOUND',
    )
    const active = expectOk(await Repo.findActiveByTicket(master.id))
    expect(active?.id).toBe(created.id)
    expect(active?._count).toEqual({ links: 1, pages: 1 })
    expect(expectOk(await Repo.findActiveByTicket(child.id))).toBeNull()
  })

  it('lists by state, newest first, and per ticket', async () => {
    const { workspace, master, child, open } = await setup()
    const third = await seedSdTicket(workspace.id, open.id)
    const old = await seedSdMajorIncident(workspace.id, third.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    })
    const live = await seedSdMajorIncident(workspace.id, master.id, {
      childIds: [child.id],
    })
    const idsOf = async (filter: 'ACTIVE' | 'RESOLVED' | 'ALL') =>
      expectOk(
        await Repo.list({ workspaceId: workspace.id, filter, limit: 10 }),
      ).map((r) => r.id)

    expect(await idsOf('ACTIVE')).toEqual([live.id])
    expect(await idsOf('RESOLVED')).toEqual([old.id])
    expect((await idsOf('ALL')).sort()).toEqual([live.id, old.id].sort())

    const forMaster = expectOk(await Repo.listForTicket(master.id))
    expect(forMaster.master.map((r) => r.id)).toEqual([live.id])
    expect(forMaster.child).toEqual([])
    const forChild = expectOk(await Repo.listForTicket(child.id))
    expect(forChild.child.map((r) => r.id)).toEqual([live.id])
    expect(expectOk(await Repo.activeIncidentOfChild(child.id))?.id).toBe(
      live.id,
    )
    expect(expectOk(await Repo.activeIncidentOfChild(master.id))).toBeNull()
  })

  it('updates fields and replaces the pages', async () => {
    const { workspace, agent, master } = await setup()
    const [a, b] = await Promise.all([
      seedSdStatusPage(workspace.id),
      seedSdStatusPage(workspace.id),
    ])
    const incident = await seedSdMajorIncident(workspace.id, master.id, {
      pageIds: [a.id],
    })
    const updated = expectOk(
      await Repo.update(incident.id, workspace.id, {
        title: 'Novo título',
        summary: 'Resumo',
        impact: 'DEGRADED',
        commanderId: agent.id,
        pageIds: [b.id],
      }),
    )
    expect(updated.title).toBe('Novo título')
    expect(updated.impact).toBe('DEGRADED')
    expect(updated.pages.map((p) => p.pageId)).toEqual([b.id])

    const keep = expectOk(
      await Repo.update(incident.id, workspace.id, { title: 'Só título' }),
    )
    expect(keep.pages).toHaveLength(1)
  })

  it('appends updates, moves the status and resolves', async () => {
    const { workspace, agent, master } = await setup()
    const incident = await seedSdMajorIncident(workspace.id, master.id)
    const upd = expectOk(
      await Repo.addUpdate(incident.id, workspace.id, {
        status: 'IDENTIFIED',
        message: 'Causa achada',
        publish: false,
        authorId: agent.id,
        impact: 'MAJOR_OUTAGE',
      }),
    )
    expect(upd.status).toBe('IDENTIFIED')
    let row = expectOk(await Repo.findById(incident.id, workspace.id))
    expect(row.status).toBe('IDENTIFIED')
    expect(row.impact).toBe('MAJOR_OUTAGE')

    await Repo.addUpdate(incident.id, workspace.id, {
      status: 'MONITORING',
      message: 'Monitorando',
      publish: true,
      authorId: agent.id,
    })
    row = expectOk(await Repo.findById(incident.id, workspace.id))
    expect(row.impact).toBe('MAJOR_OUTAGE')

    expectOk(
      await Repo.resolve(incident.id, workspace.id, {
        message: 'Resolvido',
        publish: true,
        resolution: 'Trocamos o link',
        resolvedById: agent.id,
      }),
    )
    row = expectOk(await Repo.findById(incident.id, workspace.id))
    expect(row.status).toBe('RESOLVED')
    expect(row.resolution).toBe('Trocamos o link')
    expect(row.resolvedAt).toBeInstanceOf(Date)
    expect(row.updates).toHaveLength(4)
    expect(expectOk(await Repo.findActiveByTicket(master.id))).toBeNull()
  })

  it('links, lists and unlinks child tickets without duplicating', async () => {
    const { workspace, agent, master, child, open } = await setup()
    const other = await seedSdTicket(workspace.id, open.id)
    const incident = await seedSdMajorIncident(workspace.id, master.id)

    expect(
      expectOk(await Repo.linkTickets(incident.id, workspace.id, [], null)),
    ).toBe(0)
    expect(
      expectOk(
        await Repo.linkTickets(
          incident.id,
          workspace.id,
          [
            { ticketId: child.id, source: 'SUGGESTION' },
            { ticketId: other.id, source: 'MONITORING' },
          ],
          agent.id,
        ),
      ),
    ).toBe(2)
    expect(
      expectOk(
        await Repo.linkTickets(
          incident.id,
          workspace.id,
          [{ ticketId: child.id, source: 'MANUAL' }],
          agent.id,
        ),
      ),
    ).toBe(0)
    expect(expectOk(await Repo.linkedTicketIds(incident.id)).sort()).toEqual(
      [child.id, other.id].sort(),
    )

    expect(expectOk(await Repo.unlinkTicket(incident.id, child.id))).toBe(true)
    expect(expectOk(await Repo.unlinkTicket(incident.id, child.id))).toBe(false)
  })

  it('suggests open incident tickets that share category, CI or customer', async () => {
    const { workspace, phase, open, resolved } = await setup()
    const cat = await seedSdCategory(workspace.id)
    const other = await seedSdCategory(workspace.id, { name: 'Outra' })
    const master = await seedSdTicket(workspace.id, phase.id, {
      categoryId: cat.id,
    })
    const related = await seedSdTicket(workspace.id, open.id, {
      categoryId: cat.id,
    })
    await seedSdTicket(workspace.id, open.id, { categoryId: other.id })
    await seedSdTicket(workspace.id, resolved.id, { categoryId: cat.id })
    await seedSdTicket(workspace.id, open.id, {
      categoryId: cat.id,
      type: 'SERVICE_REQUEST',
    })

    const query = {
      workspaceId: workspace.id,
      excludeTicketIds: [master.id],
      since: new Date(Date.now() - 86_400_000),
      categoryId: cat.id,
      configItemId: null,
      customerId: null,
      limit: 10,
    }
    const found = expectOk(await Repo.findRelatedTickets(query))
    expect(found.map((t) => t.id)).toEqual([related.id])
    expect(
      expectOk(
        await Repo.findRelatedTickets({
          ...query,
          excludeTicketIds: [master.id, related.id],
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(await Repo.findRelatedTickets({ ...query, categoryId: null })),
    ).toEqual([])
    expect(
      expectOk(
        await Repo.findRelatedTickets({
          ...query,
          categoryId: null,
          configItemId: 'no-ci',
          customerId: 'no-customer',
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await Repo.findRelatedTickets({
          ...query,
          since: new Date(Date.now() + 60_000),
        }),
      ),
    ).toEqual([])
  })

  it('matches an active incident by its master ticket attributes', async () => {
    const { workspace, phase } = await setup()
    const cat = await seedSdCategory(workspace.id)
    const master = await seedSdTicket(workspace.id, phase.id, {
      categoryId: cat.id,
    })
    const incident = await seedSdMajorIncident(workspace.id, master.id)

    const hit = expectOk(
      await Repo.findActiveByTicketMatch(workspace.id, { categoryId: cat.id }),
    )
    expect(hit).toMatchObject({ id: incident.id, ticketId: master.id })
    expect(
      expectOk(await Repo.findActiveByTicketMatch(workspace.id, {})),
    ).toBeNull()
    expect(
      expectOk(
        await Repo.findActiveByTicketMatch(workspace.id, {
          configItemId: 'nope',
          customerId: 'nope',
        }),
      ),
    ).toBeNull()
    await prisma.sdMajorIncident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED' },
    })
    expect(
      expectOk(
        await Repo.findActiveByTicketMatch(workspace.id, {
          categoryId: cat.id,
        }),
      ),
    ).toBeNull()
  })

  it('claims the notification once and stores the counters', async () => {
    const { workspace, master } = await setup()
    const page = await seedSdStatusPage(workspace.id)
    const incident = await seedSdMajorIncident(workspace.id, master.id, {
      pageIds: [page.id],
    })
    const update = await prisma.sdMajorIncidentUpdate.findFirstOrThrow({
      where: { incidentId: incident.id },
    })
    const found = expectOk(await Repo.findUpdate(update.id))
    expect(found?.incident).toMatchObject({
      id: incident.id,
      workspaceId: workspace.id,
      pageIds: [page.id],
    })
    expect(expectOk(await Repo.findUpdate('missing'))).toBeNull()

    expect(expectOk(await Repo.claimNotification(update.id))).toBe(true)
    expect(expectOk(await Repo.claimNotification(update.id))).toBe(false)
    expectOk(
      await Repo.finishNotification(update.id, {
        total: 3,
        sent: 2,
        failed: 1,
      }),
    )
    const saved = await prisma.sdMajorIncidentUpdate.findUniqueOrThrow({
      where: { id: update.id },
    })
    expect(saved).toMatchObject({
      notifyTotal: 3,
      notifySent: 2,
      notifyFailed: 1,
    })
  })

  it('loads users, counts pages and sets the war room', async () => {
    const { workspace, agent, master } = await setup()
    const page = await seedSdStatusPage(workspace.id)
    const incident = await seedSdMajorIncident(workspace.id, master.id)

    const users = expectOk(await Repo.findUsers([agent.id, agent.id, '']))
    expect(users.get(agent.id)?.email).toBe(agent.email)
    expect(expectOk(await Repo.findUsers([])).size).toBe(0)

    expect(expectOk(await Repo.countPages(workspace.id, [page.id]))).toBe(1)
    expect(expectOk(await Repo.countPages('other', [page.id]))).toBe(0)

    expectOk(await Repo.setSwarm(incident.id, 'swarm1'))
    expect(
      expectOk(await Repo.findById(incident.id, workspace.id)).swarmId,
    ).toBe('swarm1')
  })

  it('maps every database failure to DATABASE_ERROR', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    const restore = [
      vi
        .spyOn(prisma.sdMajorIncident, 'create')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncident, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncident, 'findMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncident, 'update')
        .mockImplementation(boom as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentTicket, 'findMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentTicket, 'createMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentTicket, 'deleteMany')
        .mockImplementation(boom as never),
      vi.spyOn(prisma.sdTicket, 'findMany').mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentUpdate, 'findUnique')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentUpdate, 'updateMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.sdMajorIncidentUpdate, 'update')
        .mockImplementation(boom as never),
      vi.spyOn(prisma.user, 'findMany').mockImplementation(boom as never),
      vi.spyOn(prisma.sdStatusPage, 'count').mockImplementation(boom as never),
    ]
    const update = {
      status: 'MONITORING',
      message: 'm',
      publish: false,
      authorId: 'a',
    } as const
    const calls = [
      Repo.create({
        workspaceId: 'w',
        ticketId: 't',
        title: 't',
        summary: null,
        impact: 'DEGRADED',
        commanderId: null,
        declaredById: 'a',
        pageIds: [],
        children: [],
        firstUpdate: { message: 'm', publish: false },
      }),
      Repo.findById('i', 'w'),
      Repo.findActiveByTicket('t'),
      Repo.list({ workspaceId: 'w', filter: 'ALL', limit: 1 }),
      Repo.listForTicket('t'),
      Repo.update('i', 'w', { title: 'x', pageIds: ['p'] }),
      Repo.addUpdate('i', 'w', update),
      Repo.resolve('i', 'w', {
        message: 'm',
        publish: false,
        resolution: null,
        resolvedById: 'a',
      }),
      Repo.setSwarm('i', 's'),
      Repo.linkedTicketIds('i'),
      Repo.linkTickets('i', 'w', [{ ticketId: 't', source: 'MANUAL' }], null),
      Repo.unlinkTicket('i', 't'),
      Repo.findRelatedTickets({
        workspaceId: 'w',
        excludeTicketIds: [],
        since: new Date(),
        categoryId: 'c',
        configItemId: null,
        customerId: null,
        limit: 1,
      }),
      Repo.activeIncidentOfChild('t'),
      Repo.findActiveByTicketMatch('w', { categoryId: 'c' }),
      Repo.findUpdate('u'),
      Repo.claimNotification('u'),
      Repo.finishNotification('u', { total: 0, sent: 0, failed: 0 }),
      Repo.findUsers(['u']),
      Repo.countPages('w', ['p']),
    ]
    for (const result of await Promise.all(calls)) {
      expectErr(result, 'DATABASE_ERROR')
    }
    for (const spy of restore) spy.mockRestore()
  })
})
