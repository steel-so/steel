import type { Prisma, Role, SiteExperiment } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
  createFakeSiteVersion,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import { createFakeSiteExperiment } from '@/src/__tests__/factories/site-experiment.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { err, ok } from '@/src/lib/result'
import {
  resolveAbVisitorKey,
  variantFingerprints,
} from '@/src/lib/sites/experiment-runtime'
import { assignVariant } from '@/src/lib/sites/experiments'
import { buildSiteSnapshot } from '@/src/lib/sites/snapshot'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-experiment.repository')
vi.mock('@/src/services/site-page.service')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { revalidateSites } from '@/src/lib/sites/cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteExperimentRepository } from '@/src/repositories/site-experiment.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SiteExperimentService } from '../site-experiment.service'
import { SitePageService } from '../site-page.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const experiments = vi.mocked(SiteExperimentRepository)
const pageService = vi.mocked(SitePageService)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const SITE = 'site1'
const VERSION = 'v1'

/** root > [s1 (h1), s1b (variant of s1, h1b), s2 (button b1)] */
function homeDoc(text = 'B'): CanvasDocument {
  const base = createSiteDocument('Original')
  return {
    ...base,
    nodes: {
      ...base.nodes,
      root: { ...base.nodes.root, children: ['s1', 's1b', 's2'] },
      s1b: {
        ...base.nodes.s1,
        id: 's1b',
        children: ['h1b'],
        meta: { variantOf: 's1', variantKey: 'B' } as CanvasNode['meta'],
      },
      h1b: {
        ...base.nodes.h1,
        id: 'h1b',
        props: { ...base.nodes.h1.props, text },
      },
      s2: { ...base.nodes.s1, id: 's2', children: [] },
    },
  }
}

const json = (value: unknown) => value as Prisma.JsonValue

function pageRow(id: string, document: CanvasDocument, title = 'Início') {
  return createFakeSitePage({
    id,
    siteId: SITE,
    title,
    isHome: id === 'home',
    document: json(document),
  })
}

function snapshotWith(docs: Record<string, CanvasDocument>) {
  return buildSiteSnapshot({
    name: 'Clínica',
    theme: {},
    settings: {},
    homePageId: 'home',
    pages: Object.entries(docs).map(([id, document]) => pageRow(id, document)),
    globals: [],
  })
}

const site = createFakeSite({
  id: SITE,
  workspaceId: WS,
  slug: 'clinica',
  status: 'PUBLISHED',
  publishedVersionId: VERSION,
})

function experiment(overrides: Partial<SiteExperiment> = {}): SiteExperiment {
  return createFakeSiteExperiment({ id: 'e1', siteId: SITE, ...overrides })
}

const pageVariants = json([
  { key: 'A', name: 'Original', weight: 50, pageId: 'home' },
  { key: 'B', name: 'Variante B', weight: 50, pageId: 'home-b' },
])

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function publishVersion(docs: Record<string, CanvasDocument>) {
  sites.findVersion.mockResolvedValue(
    ok(
      createFakeSiteVersion({
        id: VERSION,
        siteId: SITE,
        snapshot: json(snapshotWith(docs)),
      }),
    ),
  )
}

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site))
  publishVersion({ home: homeDoc() })
  pages.findById.mockImplementation(async (id) =>
    id === 'home' || id === 'obrigado' || id === 'home-b'
      ? ok(pageRow(id, homeDoc(id)))
      : err(appError('SITE_PAGE_NOT_FOUND', 'x')),
  )
  pages.listWithDocuments.mockResolvedValue(ok([pageRow('home', homeDoc())]))
  experiments.listBySite.mockResolvedValue(ok([experiment()]))
  experiments.listActive.mockResolvedValue(ok([]))
  experiments.findById.mockResolvedValue(ok(experiment()))
  experiments.count.mockResolvedValue(ok(0))
  experiments.countEvents.mockResolvedValue(ok([]))
  experiments.create.mockImplementation(async (data) =>
    ok(
      experiment({
        ...data,
        variants: data.variants as Prisma.JsonValue,
        goal: data.goal as Prisma.JsonValue,
      }),
    ),
  )
  experiments.update.mockImplementation(async (id, data) =>
    ok(
      experiment({
        id,
        ...(data as Partial<SiteExperiment>),
      }),
    ),
  )
  experiments.delete.mockResolvedValue(ok(undefined))
  pageService.duplicate.mockImplementation(async () =>
    ok({
      ...pageRow('home-b', homeDoc()),
      seo: { title: 'x' },
      document: homeDoc(),
      createdAt: '',
      updatedAt: '',
    } as never),
  )
  pageService.update.mockResolvedValue(ok({} as never))
  pageService.remove.mockResolvedValue(ok(undefined))
})

describe('authorization', () => {
  it('blocks non-members, a disabled module, viewers and other workspaces', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await SiteExperimentService.list('u1', WS, SITE), 'FORBIDDEN')

    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await SiteExperimentService.list('u1', WS, SITE),
      'MODULE_DISABLED',
    )

    asRole('VIEWER')
    expectOk(await SiteExperimentService.list('u1', WS, SITE))
    expectOk(await SiteExperimentService.get('u1', WS, SITE, 'e1'))
    expectOk(await SiteExperimentService.impact('u1', WS, SITE))
    const denied = await Promise.all([
      SiteExperimentService.create('u1', WS, SITE, {
        name: 'x',
        kind: 'PAGE',
        pageId: 'home',
        variantCount: 1,
        goal: { type: 'FORM' },
      }),
      SiteExperimentService.update('u1', WS, SITE, 'e1', { name: 'x' }),
      SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'),
      SiteExperimentService.remove('u1', WS, SITE, 'e1'),
    ])
    for (const result of denied) expectErr(result, 'FORBIDDEN')

    asRole('MEMBER')
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SiteExperimentService.get('u1', 'other-ws', SITE, 'e1'),
      'SITE_NOT_FOUND',
    )
    expect(experiments.create).not.toHaveBeenCalled()
    expect(experiments.update).not.toHaveBeenCalled()
  })
})

describe('list and get', () => {
  it('lists the tests with results and unpublished variants', async () => {
    experiments.countEvents.mockResolvedValueOnce(
      ok([{ variantKey: 'B', kind: 'EXPOSURE', count: 3 }]),
    )
    const [item] = expectOk(await SiteExperimentService.list('u1', WS, SITE))
    expect(item.results.variants[1].visitors).toBe(3)
    expect(item.unpublishedVariants).toEqual([])

    publishVersion({ home: createSiteDocument() })
    const [missing] = expectOk(await SiteExperimentService.list('u1', WS, SITE))
    expect(missing.unpublishedVariants).toEqual(['B'])
  })

  it('treats an unpublished site as every variant missing', async () => {
    sites.findById.mockResolvedValueOnce(
      ok({ ...site, publishedVersionId: null }),
    )
    const [item] = expectOk(await SiteExperimentService.list('u1', WS, SITE))
    expect(item.unpublishedVariants).toEqual(['A', 'B'])

    sites.findVersion.mockResolvedValueOnce(
      ok(createFakeSiteVersion({ snapshot: json({ broken: true }) })),
    )
    const [broken] = expectOk(await SiteExperimentService.list('u1', WS, SITE))
    expect(broken.unpublishedVariants).toEqual(['A', 'B'])
  })

  it('propagates database errors', async () => {
    experiments.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.list('u1', WS, SITE),
      'DATABASE_ERROR',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.list('u1', WS, SITE),
      'DATABASE_ERROR',
    )
    experiments.countEvents.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.list('u1', WS, SITE),
      'DATABASE_ERROR',
    )

    experiments.findById.mockResolvedValueOnce(
      err(appError('SITE_EXPERIMENT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.get('u1', WS, SITE, 'nope'),
      'SITE_EXPERIMENT_NOT_FOUND',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.get('u1', WS, SITE, 'e1'),
      'DATABASE_ERROR',
    )
  })
})

describe('create', () => {
  it('creates a section test with an even split', async () => {
    const dto = expectOk(
      await SiteExperimentService.create('u1', WS, SITE, {
        name: 'Hero',
        kind: 'SECTION',
        pageId: 'home',
        controlNodeId: 's1',
        variantNodeIds: ['s1b'],
        variantCount: 1,
        goal: { type: 'PAGE', pageId: 'obrigado' },
        startsAt: '2026-10-20T00:00:00Z',
        endsAt: null,
      }),
    )
    expect(experiments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'SECTION',
        controlNodeId: 's1',
        startsAt: new Date('2026-10-20T00:00:00Z'),
        endsAt: null,
        variants: [
          { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
          { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
        ],
      }),
    )
    expect(dto.state).toBe('DRAFT')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_experiment', action: 'create' }),
    )
  })

  it('creates hidden copies for a page test', async () => {
    expectOk(
      await SiteExperimentService.create('u1', WS, SITE, {
        name: 'Página',
        kind: 'PAGE',
        pageId: 'home',
        variantCount: 2,
        weights: [40, 30, 30],
        goal: { type: 'FORM' },
      }),
    )
    expect(pageService.duplicate).toHaveBeenCalledTimes(2)
    expect(pageService.duplicate).toHaveBeenCalledWith('u1', WS, SITE, 'home', {
      title: 'Início (Variante B)',
    })
    expect(pageService.update).toHaveBeenCalledWith('u1', WS, SITE, 'home-b', {
      seo: { title: 'x', noindex: true },
    })
    const data = experiments.create.mock.calls[0][0]
    expect(data.controlNodeId).toBeNull()
    expect(data.variants).toEqual([
      { key: 'A', name: 'Original', weight: 40, pageId: 'home' },
      { key: 'B', name: 'Variante B', weight: 30, pageId: 'home-b' },
      { key: 'C', name: 'Variante C', weight: 30, pageId: 'home-b' },
    ])
  })

  it('enforces the limit and the pages', async () => {
    const dto = {
      name: 'x',
      kind: 'PAGE' as const,
      pageId: 'home',
      variantCount: 1,
      goal: { type: 'FORM' as const },
    }
    experiments.count.mockResolvedValueOnce(ok(50))
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'SITE_LIMIT_REACHED',
    )
    experiments.count.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'DATABASE_ERROR',
    )
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, {
        ...dto,
        pageId: 'gone',
      }),
      'SITE_PAGE_NOT_FOUND',
    )
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, {
        ...dto,
        goal: { type: 'PAGE', pageId: 'gone' },
      }),
      'SITE_PAGE_NOT_FOUND',
    )
  })

  it('propagates failures of the page copies and of the insert', async () => {
    const dto = {
      name: 'x',
      kind: 'PAGE' as const,
      pageId: 'home',
      variantCount: 1,
      goal: { type: 'FORM' as const },
    }
    pageService.duplicate.mockResolvedValueOnce(
      err(appError('SITE_LIMIT_REACHED', 'x')),
    )
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'SITE_LIMIT_REACHED',
    )
    pageService.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'DATABASE_ERROR',
    )
    experiments.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'DATABASE_ERROR',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.create('u1', WS, SITE, dto),
      'DATABASE_ERROR',
    )
  })
})

describe('update', () => {
  const variants = [
    { key: 'A' as const, name: 'Original', weight: 70, nodeId: 's1' },
    { key: 'B' as const, name: 'Variante B', weight: 30, nodeId: 's1b' },
  ]

  it('renames and reschedules without restarting', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'RUNNING' })),
    )
    expectOk(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        name: 'Novo',
        startsAt: null,
        endsAt: '2026-11-01T00:00:00Z',
      }),
    )
    expect(experiments.update).toHaveBeenCalledWith('e1', {
      name: 'Novo',
      startsAt: null,
      endsAt: new Date('2026-11-01T00:00:00Z'),
      updatedById: 'u1',
    })
    expect(revalidate).toHaveBeenCalledWith('clinica')
  })

  it('changes a draft freely and keeps the schedule dates', async () => {
    expectOk(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants,
        goal: { type: 'CLICK', nodeId: 'b1' },
        startsAt: '2026-10-20T00:00:00Z',
      }),
    )
    expect(experiments.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        variants,
        goal: { type: 'CLICK', nodeId: 'b1' },
        startsAt: new Date('2026-10-20T00:00:00Z'),
      }),
    )
    expect(experiments.update.mock.calls[0][1]).not.toHaveProperty('run')
  })

  it('asks to restart a running test before changing its setup', async () => {
    experiments.findById.mockResolvedValue(
      ok(experiment({ status: 'RUNNING' })),
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', { variants }),
      'SITE_EXPERIMENT_RUNNING',
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        goal: { type: 'CLICK', nodeId: 'b1' },
      }),
      'SITE_EXPERIMENT_RUNNING',
    )
    // Same setup sent back: no restart needed.
    expectOk(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        goal: { type: 'FORM' },
        name: 'x',
      }),
    )

    expectOk(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants,
        restart: true,
      }),
    )
    expect(experiments.update).toHaveBeenLastCalledWith(
      'e1',
      expect.objectContaining({
        run: 2,
        startedAt: expect.any(Date),
        fingerprints: variantFingerprints(
          {
            kind: 'SECTION',
            pageId: 'home',
            controlNodeId: 's1',
            variants,
          },
          [{ id: 'home', document: homeDoc() }],
        ),
      }),
    )
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: expect.objectContaining({ restarted: true }),
      }),
    )

    publishVersion({ home: createSiteDocument() })
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants,
        restart: true,
      }),
      'SITE_EXPERIMENT_NOT_PUBLISHED',
    )
  })

  it('validates the variants and the goal against the test', async () => {
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants: [variants[0], { ...variants[1], nodeId: undefined }],
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants: [{ ...variants[0], nodeId: 's2' }, variants[1]],
      }),
      'VALIDATION_ERROR',
    )
    experiments.findById.mockResolvedValueOnce(
      ok(
        experiment({
          kind: 'PAGE',
          controlNodeId: null,
          variants: pageVariants,
        }),
      ),
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants: [
          { key: 'A', name: 'A', weight: 50, pageId: 'outra' },
          { key: 'B', name: 'B', weight: 50, pageId: 'home-b' },
        ],
      }),
      'VALIDATION_ERROR',
    )
    experiments.findById.mockResolvedValueOnce(
      ok(
        experiment({
          kind: 'PAGE',
          controlNodeId: null,
          variants: pageVariants,
        }),
      ),
    )
    expectOk(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        variants: [
          { key: 'A', name: 'A', weight: 60, pageId: 'home' },
          { key: 'B', name: 'B', weight: 40, pageId: 'home-b' },
        ],
      }),
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', {
        goal: { type: 'PAGE', pageId: 'home' },
      }),
      'VALIDATION_ERROR',
    )
  })

  it('refuses ended tests and propagates failures', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'ENDED' })),
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', { name: 'x' }),
      'SITE_EXPERIMENT_INVALID_STATE',
    )
    experiments.findById.mockResolvedValueOnce(
      err(appError('SITE_EXPERIMENT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', { name: 'x' }),
      'SITE_EXPERIMENT_NOT_FOUND',
    )
    experiments.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', { name: 'x' }),
      'DATABASE_ERROR',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.update('u1', WS, SITE, 'e1', { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('transition', () => {
  it('starts a published test and stores its fingerprints', async () => {
    const dto = expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
    )
    expect(experiments.update).toHaveBeenCalledWith('e1', {
      status: 'RUNNING',
      startedAt: expect.any(Date),
      fingerprints: expect.objectContaining({ A: expect.any(String) }),
      updatedById: 'u1',
    })
    expect(dto.state).toBe('RUNNING')
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'start' }),
    )
  })

  it('needs every variant on the live site', async () => {
    publishVersion({ home: createSiteDocument() })
    const missing = expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      'SITE_EXPERIMENT_NOT_PUBLISHED',
    )
    expect(missing.message).toBe(
      'Publique o site com Variante B antes de iniciar o teste',
    )
    sites.findById.mockResolvedValueOnce(
      ok({ ...site, publishedVersionId: null }),
    )
    expect(
      expectErr(
        await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      ).message,
    ).toBe('Publique o site antes de iniciar o teste')
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      'DATABASE_ERROR',
    )
  })

  it('refuses overlapping tests on the same section or page', async () => {
    experiments.listActive.mockResolvedValueOnce(
      ok([experiment({ id: 'other', name: 'Outro', status: 'RUNNING' })]),
    )
    expect(
      expectErr(
        await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
        'SITE_EXPERIMENT_CONFLICT',
      ).message,
    ).toBe('O teste "Outro" já está rodando nesta seção')
    experiments.listActive.mockResolvedValueOnce(
      ok([
        experiment({
          id: 'page',
          name: 'Página',
          kind: 'PAGE',
          controlNodeId: null,
          status: 'RUNNING',
        }),
      ]),
    )
    expect(
      expectErr(
        await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      ).message,
    ).toBe('O teste "Página" já está rodando nesta página')
    // Another section, another page or the test itself are fine.
    experiments.listActive.mockResolvedValueOnce(
      ok([
        experiment({ id: 'e1', status: 'PAUSED' }),
        experiment({ id: 'x', controlNodeId: 's2', status: 'RUNNING' }),
        experiment({ id: 'y', pageId: 'sobre', status: 'RUNNING' }),
      ]),
    )
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
    )
    experiments.listActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
      'DATABASE_ERROR',
    )
  })

  it('pauses, stops and restarts', async () => {
    experiments.findById.mockResolvedValue(
      ok(experiment({ status: 'RUNNING', run: 3 })),
    )
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'pause'),
    )
    expect(experiments.update).toHaveBeenLastCalledWith('e1', {
      status: 'PAUSED',
      updatedById: 'u1',
    })
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'stop'),
    )
    expect(experiments.update).toHaveBeenLastCalledWith('e1', {
      status: 'ENDED',
      endedAt: expect.any(Date),
      updatedById: 'u1',
    })
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'restart'),
    )
    expect(experiments.update).toHaveBeenLastCalledWith(
      'e1',
      expect.objectContaining({ status: 'RUNNING', run: 4 }),
    )
    expect(experiments.listActive).not.toHaveBeenCalled()
  })

  it('resumes a paused test, restarting it when its content changed', async () => {
    const fingerprints = variantFingerprints(
      {
        kind: 'SECTION',
        pageId: 'home',
        controlNodeId: 's1',
        variants: [
          { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
          { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
        ],
      },
      [{ id: 'home', document: homeDoc() }],
    )
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'PAUSED', fingerprints })),
    )
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'resume'),
    )
    expect(experiments.update).toHaveBeenLastCalledWith('e1', {
      status: 'RUNNING',
      updatedById: 'u1',
    })

    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'PAUSED', run: 2, fingerprints: { A: 'old' } })),
    )
    expectOk(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'resume'),
    )
    expect(experiments.update).toHaveBeenLastCalledWith(
      'e1',
      expect.objectContaining({ status: 'RUNNING', run: 3 }),
    )
  })

  it('refuses actions that do not fit the status', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'ENDED' })),
    )
    expect(
      expectErr(
        await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'start'),
        'SITE_EXPERIMENT_INVALID_STATE',
      ).message,
    ).toBe('Este teste já terminou')
    expect(
      expectErr(
        await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'pause'),
        'SITE_EXPERIMENT_INVALID_STATE',
      ).message,
    ).toBe('Esta ação não vale para o estado atual do teste')
    experiments.findById.mockResolvedValueOnce(
      err(appError('SITE_EXPERIMENT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'stop'),
      'SITE_EXPERIMENT_NOT_FOUND',
    )
    experiments.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'stop'),
      'DATABASE_ERROR',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.transition('u1', WS, SITE, 'e1', 'stop'),
      'DATABASE_ERROR',
    )
  })
})

describe('applyWinner', () => {
  it('promotes a winning section into the draft and ends the test', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'RUNNING' })),
    )
    const dto = expectOk(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
    )
    const saved = pageService.update.mock.calls[0][4].document as CanvasDocument
    expect(saved.nodes.root.children).toEqual(['s1b', 's2'])
    expect(saved.nodes.s1).toBeUndefined()
    expect(experiments.update).toHaveBeenCalledWith('e1', {
      status: 'ENDED',
      endedAt: expect.any(Date),
      winnerKey: 'B',
      updatedById: 'u1',
    })
    expect(dto).toBeDefined()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apply_winner' }),
    )
  })

  it('keeps the original and removes the challengers when A wins', async () => {
    const ended = new Date('2026-10-10T00:00:00Z')
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ status: 'ENDED', endedAt: ended })),
    )
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'))
    const saved = pageService.update.mock.calls[0][4].document as CanvasDocument
    expect(saved.nodes.root.children).toEqual(['s1', 's2'])
    expect(experiments.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ endedAt: ended }),
    )

    // Nothing left to remove: the draft is not saved again.
    pageService.update.mockClear()
    pages.findById.mockResolvedValueOnce(
      ok(pageRow('home', createSiteDocument())),
    )
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'))
    expect(pageService.update).not.toHaveBeenCalled()
  })

  it('refuses a second winner, unknown variants and a vanished winner', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ winnerKey: 'A' })),
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'SITE_EXPERIMENT_INVALID_STATE',
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'C'),
      'VALIDATION_ERROR',
    )
    pages.findById.mockResolvedValueOnce(
      ok(pageRow('home', createSiteDocument())),
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'VALIDATION_ERROR',
    )
    experiments.findById.mockResolvedValueOnce(
      err(appError('SITE_EXPERIMENT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'SITE_EXPERIMENT_NOT_FOUND',
    )
  })

  it('tolerates a deleted page and propagates draft failures', async () => {
    pages.findById.mockResolvedValueOnce(
      err(appError('SITE_PAGE_NOT_FOUND', 'x')),
    )
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'))
    pages.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'DATABASE_ERROR',
    )
    pageService.update.mockResolvedValueOnce(
      err(appError('SITE_DOCUMENT_INVALID', 'x')),
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'SITE_DOCUMENT_INVALID',
    )
    experiments.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'DATABASE_ERROR',
    )
    sites.findVersion.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'DATABASE_ERROR',
    )
  })

  it('copies a winning page into the tested page and removes the copies', async () => {
    const pageTest = experiment({
      kind: 'PAGE',
      controlNodeId: null,
      variants: pageVariants,
    })
    experiments.findById.mockResolvedValue(ok(pageTest))
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'))
    expect(pageService.update).toHaveBeenCalledWith('u1', WS, SITE, 'home', {
      document: homeDoc('home-b'),
    })
    expect(pageService.remove).toHaveBeenCalledWith('u1', WS, SITE, 'home-b')

    pageService.update.mockClear()
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'))
    expect(pageService.update).not.toHaveBeenCalled()

    pageService.remove.mockResolvedValueOnce(
      err(appError('SITE_PAGE_NOT_FOUND', 'x')),
    )
    expectOk(await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'))
    pageService.remove.mockResolvedValueOnce(
      err(appError('SITE_PAGE_PROTECTED', 'x')),
    )
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'A'),
      'SITE_PAGE_PROTECTED',
    )
    pages.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'DATABASE_ERROR',
    )
    pageService.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.applyWinner('u1', WS, SITE, 'e1', 'B'),
      'DATABASE_ERROR',
    )
  })
})

describe('remove', () => {
  it('removes the challengers from the draft, then the test', async () => {
    expectOk(await SiteExperimentService.remove('u1', WS, SITE, 'e1'))
    const saved = pageService.update.mock.calls[0][4].document as CanvasDocument
    expect(saved.nodes.root.children).toEqual(['s1', 's2'])
    expect(experiments.delete).toHaveBeenCalledWith('e1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
  })

  it('leaves the draft alone after a winner and without variants', async () => {
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ winnerKey: 'B' })),
    )
    expectOk(await SiteExperimentService.remove('u1', WS, SITE, 'e1'))
    experiments.findById.mockResolvedValueOnce(
      ok(experiment({ variants: json([]) })),
    )
    expectOk(await SiteExperimentService.remove('u1', WS, SITE, 'e1'))
    expect(pageService.update).not.toHaveBeenCalled()
  })

  it('propagates failures', async () => {
    experiments.findById.mockResolvedValueOnce(
      err(appError('SITE_EXPERIMENT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.remove('u1', WS, SITE, 'e1'),
      'SITE_EXPERIMENT_NOT_FOUND',
    )
    pageService.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.remove('u1', WS, SITE, 'e1'),
      'DATABASE_ERROR',
    )
    experiments.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.remove('u1', WS, SITE, 'e1'),
      'DATABASE_ERROR',
    )
  })
})

describe('publication', () => {
  const variants = [
    { key: 'A' as const, name: 'Original', weight: 50, nodeId: 's1' },
    { key: 'B' as const, name: 'Variante B', weight: 50, nodeId: 's1b' },
  ]
  const printsOf = (doc: CanvasDocument) =>
    variantFingerprints(
      { kind: 'SECTION', pageId: 'home', controlNodeId: 's1', variants },
      [{ id: 'home', document: doc }],
    )

  it('lists the running tests the next publish restarts', async () => {
    experiments.listActive.mockResolvedValue(
      ok([
        experiment({ id: 'same', fingerprints: printsOf(homeDoc()) }),
        experiment({
          id: 'changed',
          name: 'Hero',
          fingerprints: printsOf(homeDoc('old')),
        }),
      ]),
    )
    expect(
      expectOk(await SiteExperimentService.impact('u1', WS, SITE)),
    ).toEqual({
      experiments: [{ id: 'changed', name: 'Hero', variants: ['B'] }],
    })
    experiments.listActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.impact('u1', WS, SITE),
      'DATABASE_ERROR',
    )
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.impact('u1', WS, SITE),
      'DATABASE_ERROR',
    )
  })

  it('restarts running tests whose published variants changed', async () => {
    experiments.listActive.mockResolvedValue(
      ok([
        experiment({
          id: 'same',
          status: 'RUNNING',
          fingerprints: printsOf(homeDoc()),
        }),
        experiment({
          id: 'changed',
          status: 'RUNNING',
          run: 4,
          fingerprints: printsOf(homeDoc('old')),
        }),
        experiment({ id: 'paused', status: 'PAUSED', fingerprints: {} }),
      ]),
    )
    const snapshot = {
      pages: [{ ...snapshotWith({ home: homeDoc() }).pages[0] }],
    }
    expect(
      expectOk(await SiteExperimentService.syncWithPublication(SITE, snapshot)),
    ).toEqual(['changed'])
    expect(experiments.update).toHaveBeenCalledTimes(1)
    expect(experiments.update).toHaveBeenCalledWith('changed', {
      run: 5,
      startedAt: expect.any(Date),
      fingerprints: printsOf(homeDoc()),
    })

    experiments.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.syncWithPublication(SITE, snapshot),
      'DATABASE_ERROR',
    )
    experiments.listActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.syncWithPublication(SITE, snapshot),
      'DATABASE_ERROR',
    )
  })
})

describe('public runtime', () => {
  const published = {
    ...site,
    publishedVersion: {
      id: VERSION,
      snapshot: json({}),
      createdAt: new Date(),
    },
  }
  const request = { ip: '203.0.113.9', userAgent: 'UA', cookie: null }
  const NOW = new Date('2026-10-15T12:00:00Z')
  const key = resolveAbVisitorKey({
    ...request,
    siteId: SITE,
    secret: BETTER_AUTH_SECRET,
    now: NOW,
  })
  const running = experiment({ status: 'RUNNING', run: 2 })

  beforeEach(() => {
    sites.findPublishedBySlug.mockResolvedValue(ok(published as never))
    experiments.listRunningBySlug.mockResolvedValue(ok([running]))
    experiments.findExposure.mockResolvedValue(ok('B'))
    experiments.recordEvent.mockResolvedValue(ok(true))
  })

  it('lists the running tests of a slug', async () => {
    expect(
      expectOk(await SiteExperimentService.runningForSlug('clinica')).map(
        (item) => item.id,
      ),
    ).toEqual(['e1'])
    experiments.listRunningBySlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.runningForSlug('clinica'),
      'DATABASE_ERROR',
    )
  })

  it('records the exposure for the variant computed on the server', async () => {
    const result = expectOk(
      await SiteExperimentService.recordEvents(
        'clinica',
        { ...request, now: NOW },
        {
          events: [
            { experimentId: 'e1', kind: 'EXPOSURE' },
            { experimentId: 'e1', kind: 'EXPOSURE' },
            { experimentId: 'unknown', kind: 'EXPOSURE' },
          ],
        },
      ),
    )
    expect(result).toEqual({ recorded: 1 })
    expect(experiments.recordEvent).toHaveBeenCalledTimes(1)
    expect(experiments.recordEvent).toHaveBeenCalledWith({
      experimentId: 'e1',
      run: 2,
      variantKey: assignVariant(
        [
          { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
          { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
        ],
        'e1',
        key,
      ),
      kind: 'EXPOSURE',
      visitorKey: key,
    })
  })

  it('uses the consented cookie as the visitor key', async () => {
    const cookie = 'c'.repeat(32)
    await SiteExperimentService.recordEvents(
      'clinica',
      { ...request, cookie },
      { events: [{ experimentId: 'e1', kind: 'EXPOSURE' }] },
    )
    expect(experiments.recordEvent.mock.calls[0][0].visitorKey).toBe(cookie)
  })

  it('counts a conversion only after an exposure, for the variant seen', async () => {
    expectOk(
      await SiteExperimentService.recordEvents('clinica', request, {
        events: [{ experimentId: 'e1', kind: 'CONVERSION' }],
      }),
    )
    expect(experiments.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CONVERSION', variantKey: 'B' }),
    )
    experiments.recordEvent.mockClear()
    experiments.findExposure.mockResolvedValueOnce(ok(null))
    experiments.recordEvent.mockResolvedValueOnce(ok(false))
    expect(
      expectOk(
        await SiteExperimentService.recordEvents('clinica', request, {
          events: [
            { experimentId: 'e1', kind: 'CONVERSION' },
            { experimentId: 'e1', kind: 'EXPOSURE' },
          ],
        }),
      ),
    ).toEqual({ recorded: 0 })
    expect(experiments.recordEvent).toHaveBeenCalledTimes(1)
  })

  it('ignores tests outside their schedule', async () => {
    experiments.listRunningBySlug.mockResolvedValueOnce(
      ok([experiment({ status: 'RUNNING', startsAt: new Date('2099-01-01') })]),
    )
    expect(
      expectOk(
        await SiteExperimentService.recordEvents('clinica', request, {
          events: [{ experimentId: 'e1', kind: 'EXPOSURE' }],
        }),
      ),
    ).toEqual({ recorded: 0 })
  })

  it('hides unknown sites and a disabled module, and propagates failures', async () => {
    const events = {
      events: [{ experimentId: 'e1', kind: 'CONVERSION' as const }],
    }
    sites.findPublishedBySlug.mockResolvedValueOnce(
      err(appError('SITE_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteExperimentService.recordEvents('nope', request, events),
      'SITE_NOT_FOUND',
    )
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await SiteExperimentService.recordEvents('clinica', request, events),
      'SITE_NOT_FOUND',
    )
    experiments.listRunningBySlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.recordEvents('clinica', request, events),
      'DATABASE_ERROR',
    )
    experiments.findExposure.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.recordEvents('clinica', request, events),
      'DATABASE_ERROR',
    )
    experiments.recordEvent.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteExperimentService.recordEvents('clinica', request, events),
      'DATABASE_ERROR',
    )
  })
})
