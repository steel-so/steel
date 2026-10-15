import { describe, expect, it, vi } from 'vitest'
import { seedSite } from '@/src/__tests__/factories/site.factory'
import { seedSiteExperiment } from '@/src/__tests__/factories/site-experiment.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteExperimentRepository } from '../site-experiment.repository'

describe('SiteExperimentRepository', () => {
  it('creates, lists, updates and deletes experiments', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id, {
      slug: 'ab-site',
      status: 'PUBLISHED',
    })
    const other = await seedSite(workspace.id, user.id)

    const created = expectOk(
      await SiteExperimentRepository.create({
        siteId: site.id,
        pageId: 'home',
        name: 'Hero',
        kind: 'SECTION',
        controlNodeId: 's1',
        variants: [{ key: 'A', name: 'Original', weight: 100, nodeId: 's1' }],
        goal: { type: 'FORM' },
        startsAt: null,
        endsAt: new Date('2026-12-01T00:00:00Z'),
        createdById: user.id,
      }),
    )
    expect(created.status).toBe('DRAFT')
    expect(created.run).toBe(1)
    const paused = await seedSiteExperiment(site.id, user.id, {
      status: 'PAUSED',
    })
    await seedSiteExperiment(other.id, user.id, { status: 'RUNNING' })

    expect(
      expectOk(await SiteExperimentRepository.listBySite(site.id)),
    ).toHaveLength(2)
    expect(expectOk(await SiteExperimentRepository.count(site.id))).toBe(2)
    expect(
      expectOk(await SiteExperimentRepository.listActive(site.id)).map(
        (item) => item.id,
      ),
    ).toEqual([paused.id])
    expect(
      expectOk(await SiteExperimentRepository.findById(created.id, site.id))
        .name,
    ).toBe('Hero')
    expectErr(
      await SiteExperimentRepository.findById(created.id, other.id),
      'SITE_EXPERIMENT_NOT_FOUND',
    )

    const running = expectOk(
      await SiteExperimentRepository.update(created.id, {
        status: 'RUNNING',
        startedAt: new Date(),
        fingerprints: { A: 'x' },
      }),
    )
    expect(running.status).toBe('RUNNING')
    expect(
      expectOk(await SiteExperimentRepository.listRunningBySlug('ab-site')).map(
        (item) => item.id,
      ),
    ).toEqual([created.id])

    // Unpublished or deleted sites run no tests.
    await prisma.site.update({
      where: { id: site.id },
      data: { status: 'DRAFT' },
    })
    expect(
      expectOk(await SiteExperimentRepository.listRunningBySlug('ab-site')),
    ).toEqual([])

    expectOk(await SiteExperimentRepository.delete(paused.id))
    expect(expectOk(await SiteExperimentRepository.count(site.id))).toBe(1)
  })

  it('records each event once per visitor, kind and run', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id)
    const experiment = await seedSiteExperiment(site.id, user.id, {
      status: 'RUNNING',
    })
    const base = { experimentId: experiment.id, run: 1 }

    expect(
      expectOk(
        await SiteExperimentRepository.recordEvent({
          ...base,
          variantKey: 'A',
          kind: 'EXPOSURE',
          visitorKey: 'v1',
        }),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await SiteExperimentRepository.recordEvent({
          ...base,
          variantKey: 'A',
          kind: 'EXPOSURE',
          visitorKey: 'v1',
        }),
      ),
    ).toBe(false)
    for (const [variantKey, visitorKey] of [
      ['B', 'v2'],
      ['B', 'v3'],
    ]) {
      await SiteExperimentRepository.recordEvent({
        ...base,
        variantKey,
        kind: 'EXPOSURE',
        visitorKey,
      })
    }
    await SiteExperimentRepository.recordEvent({
      ...base,
      variantKey: 'B',
      kind: 'CONVERSION',
      visitorKey: 'v2',
    })
    // Another run is counted apart.
    await SiteExperimentRepository.recordEvent({
      ...base,
      run: 2,
      variantKey: 'A',
      kind: 'EXPOSURE',
      visitorKey: 'v1',
    })

    const counts = expectOk(
      await SiteExperimentRepository.countEvents(experiment.id, 1),
    )
    expect(
      counts.sort((a, b) =>
        `${a.variantKey}${a.kind}`.localeCompare(`${b.variantKey}${b.kind}`),
      ),
    ).toEqual([
      { variantKey: 'A', kind: 'EXPOSURE', count: 1 },
      { variantKey: 'B', kind: 'CONVERSION', count: 1 },
      { variantKey: 'B', kind: 'EXPOSURE', count: 2 },
    ])
    expect(
      expectOk(
        await SiteExperimentRepository.findExposure(experiment.id, 1, 'v2'),
      ),
    ).toBe('B')
    expect(
      expectOk(
        await SiteExperimentRepository.findExposure(experiment.id, 1, 'zz'),
      ),
    ).toBeNull()
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi
        .spyOn(prisma.siteExperiment, 'findMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperiment, 'findFirst')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperiment, 'count')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperiment, 'create')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperiment, 'update')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperiment, 'delete')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperimentEvent, 'groupBy')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperimentEvent, 'findUnique')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteExperimentEvent, 'createMany')
        .mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SiteExperimentRepository.listBySite('s'),
      SiteExperimentRepository.listActive('s'),
      SiteExperimentRepository.listRunningBySlug('s'),
      SiteExperimentRepository.count('s'),
      SiteExperimentRepository.findById('e', 's'),
      SiteExperimentRepository.create({
        siteId: 's',
        pageId: 'p',
        name: 'x',
        kind: 'PAGE',
        controlNodeId: null,
        variants: [],
        goal: { type: 'FORM' },
        startsAt: null,
        endsAt: null,
        createdById: 'u',
      }),
      SiteExperimentRepository.update('e', { name: 'y' }),
      SiteExperimentRepository.delete('e'),
      SiteExperimentRepository.countEvents('e', 1),
      SiteExperimentRepository.findExposure('e', 1, 'v'),
      SiteExperimentRepository.recordEvent({
        experimentId: 'e',
        run: 1,
        variantKey: 'A',
        kind: 'EXPOSURE',
        visitorKey: 'v',
      }),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
