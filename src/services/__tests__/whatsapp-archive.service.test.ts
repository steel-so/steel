import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import {
  createFakeDoneWhatsAppArchive,
  createFakeWhatsAppArchive,
  createFakeWhatsAppArchiveSettings,
} from '@/src/__tests__/factories/whatsapp-archive.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound, whatsappArchiveNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/whatsapp-archive.repository', () => ({
  WhatsAppArchiveRepository: {
    getSettings: vi.fn(),
    upsertSettings: vi.fn(),
    listEnabledWorkspaces: vi.fn(),
    listByWorkspace: vi.fn(),
    findById: vi.fn(),
    findActive: vi.fn(),
    findForPeriod: vi.fn(),
    create: vi.fn(),
    markFailed: vi.fn(),
  },
}))
vi.mock('@/src/lib/queue/whatsapp-archive', () => ({
  enqueueWhatsappArchiveBuild: vi.fn(),
}))
vi.mock('@/src/lib/storage/offsite-backup', () => ({
  getOffsiteConfig: vi.fn(() => null),
}))
vi.mock('@/src/lib/admin-audit', () => ({ recordAdminAction: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { enqueueWhatsappArchiveBuild } from '@/src/lib/queue/whatsapp-archive'
import { getOffsiteConfig } from '@/src/lib/storage/offsite-backup'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppArchiveRepository } from '@/src/repositories/whatsapp-archive.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppArchiveService as Service } from '../whatsapp-archive.service'

const membershipRepo = vi.mocked(MembershipRepository)
const userRepo = vi.mocked(UserRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const repo = vi.mocked(WhatsAppArchiveRepository)
const enqueue = vi.mocked(enqueueWhatsappArchiveBuild)
const audit = vi.mocked(auditMutation)
const adminAudit = vi.mocked(recordAdminAction)

const ACTOR = 'u1'
const WS = 'ws1'
// Monday 26/10/2026 02:00 in São Paulo.
const NOW = new Date('2026-10-26T05:00:00.000Z')
const workspace = createFakeWorkspace({ id: WS, slug: 'fidelizza-mais' })
const platformAdmin = createFakeUser({
  id: 'admin1',
  isPlatformAdmin: true,
  email: 'ops@stratustelecom.com.br',
})

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: ACTOR, workspaceId: WS })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('ADMIN')
  userRepo.findById.mockResolvedValue(ok(platformAdmin))
  workspaceRepo.findById.mockResolvedValue(ok(workspace))
  repo.getSettings.mockResolvedValue(ok(createFakeWhatsAppArchiveSettings()))
  repo.listByWorkspace.mockResolvedValue(ok([]))
  repo.findActive.mockResolvedValue(ok(null))
  repo.findForPeriod.mockResolvedValue(ok(null))
  repo.create.mockImplementation(async (data) =>
    ok(createFakeWhatsAppArchive({ id: 'new1', ...data })),
  )
  repo.markFailed.mockResolvedValue(ok(true))
  enqueue.mockResolvedValue(undefined)
})

describe('request', () => {
  it('queues the previous week and audits it', async () => {
    const { archive, created } = expectOk(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
        now: NOW,
      }),
    )
    expect(created).toBe(true)
    expect(archive.id).toBe('new1')
    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: WS,
      kind: 'WEEKLY',
      periodStart: new Date('2026-10-19T03:00:00.000Z'),
      periodEnd: new Date('2026-10-26T02:59:59.999Z'),
      triggeredById: ACTOR,
    })
    expect(enqueue).toHaveBeenCalledWith('new1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_archive',
        action: 'request',
        actorId: ACTOR,
        meta: expect.objectContaining({ source: 'admin', kind: 'WEEKLY' }),
      }),
    )
    // Admin/script runs regenerate: no lookup of the period.
    expect(repo.findForPeriod).not.toHaveBeenCalled()
  })

  it('uses the current clock and "system" without an actor', async () => {
    expectOk(
      await Service.request({
        workspaceId: WS,
        kind: 'MONTHLY_FULL',
        triggeredById: null,
        source: 'script',
      }),
    )
    expect(repo.create.mock.calls[0][0].periodStart).toBeNull()
    expect(audit.mock.calls[0][0].actorId).toBe('system')
  })

  it('is refused while the archive is off or never configured', async () => {
    repo.getSettings.mockResolvedValueOnce(
      ok(createFakeWhatsAppArchiveSettings({ enabled: false })),
    )
    expectErr(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
      }),
      'WHATSAPP_ARCHIVE_DISABLED',
    )
    repo.getSettings.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
      }),
      'WHATSAPP_ARCHIVE_DISABLED',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('is refused while another package of the kind is running', async () => {
    repo.findActive.mockResolvedValue(
      ok(createFakeWhatsAppArchive({ status: 'RUNNING' })),
    )
    expectErr(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
      }),
      'WHATSAPP_ARCHIVE_IN_PROGRESS',
    )
  })

  it('schedule is idempotent per period', async () => {
    const existing = createFakeDoneWhatsAppArchive({ id: 'old' })
    repo.findForPeriod.mockResolvedValue(ok(existing))
    repo.findById.mockResolvedValue(ok(existing))
    const { archive, created } = expectOk(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: null,
        source: 'schedule',
        now: NOW,
      }),
    )
    expect(created).toBe(false)
    expect(archive.id).toBe('old')
    expect(repo.findForPeriod).toHaveBeenCalledWith(
      WS,
      'WEEKLY',
      new Date('2026-10-26T02:59:59.999Z'),
    )
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('schedule creates when the period has no package', async () => {
    expect(
      expectOk(
        await Service.request({
          workspaceId: WS,
          kind: 'WEEKLY',
          triggeredById: null,
          source: 'schedule',
          now: NOW,
        }),
      ).created,
    ).toBe(true)
  })

  it('marks the package failed when the queue refuses it', async () => {
    enqueue.mockRejectedValueOnce(new Error('redis down'))
    expectErr(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
      }),
      'WHATSAPP_ARCHIVE_NOT_READY',
    )
    expect(repo.markFailed).toHaveBeenCalledWith('new1', 'redis down')

    enqueue.mockRejectedValueOnce('raw')
    expectErr(
      await Service.request({
        workspaceId: WS,
        kind: 'WEEKLY',
        triggeredById: ACTOR,
        source: 'admin',
      }),
    )
    expect(repo.markFailed).toHaveBeenLastCalledWith('new1', 'raw')
    expect(vi.mocked(logger.error)).toHaveBeenCalled()
  })

  it('propagates database errors at every step', async () => {
    const input = {
      workspaceId: WS,
      kind: 'WEEKLY' as const,
      triggeredById: null,
      source: 'schedule' as const,
      now: NOW,
    }
    repo.getSettings.mockResolvedValueOnce(err(databaseError('a')))
    expectErr(await Service.request(input), 'DATABASE_ERROR')

    repo.findForPeriod.mockResolvedValueOnce(err(databaseError('b')))
    expectErr(await Service.request(input), 'DATABASE_ERROR')

    repo.findForPeriod.mockResolvedValueOnce(
      ok(createFakeWhatsAppArchive({ id: 'x' })),
    )
    repo.findById.mockResolvedValueOnce(err(whatsappArchiveNotFound()))
    expectErr(await Service.request(input), 'WHATSAPP_ARCHIVE_NOT_FOUND')

    repo.findActive.mockResolvedValueOnce(err(databaseError('c')))
    expectErr(await Service.request(input), 'DATABASE_ERROR')

    repo.create.mockResolvedValueOnce(err(databaseError('d')))
    expectErr(await Service.request(input), 'DATABASE_ERROR')
  })
})

describe('scheduleAll', () => {
  it('counts queued, skipped and failed workspaces', async () => {
    repo.listEnabledWorkspaces.mockResolvedValue(
      ok([{ workspaceId: 'a' }, { workspaceId: 'b' }, { workspaceId: 'c' }]),
    )
    repo.findForPeriod.mockImplementation(async (workspaceId) =>
      ok(workspaceId === 'b' ? createFakeWhatsAppArchive({ id: 'b1' }) : null),
    )
    repo.findById.mockResolvedValue(ok(createFakeWhatsAppArchive({ id: 'b1' })))
    repo.findActive.mockImplementation(async (workspaceId) =>
      ok(workspaceId === 'c' ? createFakeWhatsAppArchive() : null),
    )
    expect(expectOk(await Service.scheduleAll('WEEKLY', NOW))).toEqual({
      queued: 1,
      skipped: 1,
      failed: 1,
    })
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'whatsapp_archive.schedule_failed',
      expect.objectContaining({ workspaceId: 'c' }),
    )
  })

  it('propagates the listing error', async () => {
    repo.listEnabledWorkspaces.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.scheduleAll('WEEKLY', NOW), 'DATABASE_ERROR')
  })
})

describe('overview (workspace)', () => {
  it('shows settings, packages and retention to OWNER/ADMIN', async () => {
    vi.mocked(getOffsiteConfig).mockReturnValueOnce({} as never)
    repo.listByWorkspace.mockResolvedValue(
      ok([createFakeDoneWhatsAppArchive({ id: 'a1', workspaceId: WS })]),
    )
    const overview = expectOk(await Service.overview(ACTOR, WS, { now: NOW }))
    expect(overview.settings).toMatchObject({
      enabled: true,
      effectiveRootFolderName: 'FIDELIZZAMAIS',
    })
    expect(overview.retention).toEqual({ weeklyDays: 90, monthlyMonths: 12 })
    expect(overview.offsiteConfigured).toBe(true)
    expect(overview.archives[0].downloadUrl).toBe(
      `/api/workspaces/${WS}/whatsapp/archives/a1/download`,
    )
  })

  it('works with the current clock', async () => {
    expectOk(await Service.overview(ACTOR, WS))
  })

  it.each(['MEMBER', 'VIEWER'] as const)('denies %s', async (role) => {
    asRole(role)
    expectErr(await Service.overview(ACTOR, WS), 'FORBIDDEN')
  })

  it('denies a non-member', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.overview(ACTOR, WS), 'FORBIDDEN')
  })

  it('denies when Comunicação is disabled', async () => {
    vi.mocked(WorkspaceModuleAccessRepository.isEnabled).mockResolvedValueOnce(
      ok(false),
    )
    expectErr(await Service.overview(ACTOR, WS), 'MODULE_DISABLED')
  })

  it('propagates errors of the workspace, settings and list', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(notFound('Workspace')))
    expectErr(await Service.overview(ACTOR, WS), 'RESOURCE_NOT_FOUND')
    repo.getSettings.mockResolvedValueOnce(err(databaseError('s')))
    expectErr(await Service.overview(ACTOR, WS), 'DATABASE_ERROR')
    repo.listByWorkspace.mockResolvedValueOnce(err(databaseError('l')))
    expectErr(await Service.overview(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('authorizeDownload (workspace)', () => {
  it('returns the object and audits the download', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeDoneWhatsAppArchive({ id: 'a1', workspaceId: WS })),
    )
    const target = expectOk(
      await Service.authorizeDownload(ACTOR, WS, 'a1', { now: NOW }),
    )
    expect(target).toEqual({
      bucket: 'whatsapp-archives',
      key: 'ws1/a1.zip',
      fileName: 'FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip',
      sizeBytes: 2048,
    })
    expect(repo.findById).toHaveBeenCalledWith('a1', WS)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_archive',
        action: 'download',
        actorId: ACTOR,
        targetId: 'a1',
      }),
    )
  })

  it('names the file with the default root and a null size', async () => {
    repo.findById.mockResolvedValue(
      ok(
        createFakeDoneWhatsAppArchive({
          rootFolderName: null,
          sizeBytes: null,
        }),
      ),
    )
    const target = expectOk(await Service.authorizeDownload(ACTOR, WS, 'a1'))
    expect(target.fileName).toMatch(/^FIDELIZZAMAIS-/)
    expect(target.sizeBytes).toBeNull()
  })

  it('refuses packages not ready, failed or expired', async () => {
    repo.findById.mockResolvedValueOnce(ok(createFakeWhatsAppArchive()))
    expect(
      expectErr(
        await Service.authorizeDownload(ACTOR, WS, 'a1', { now: NOW }),
        'WHATSAPP_ARCHIVE_NOT_READY',
      ).message,
    ).toBe('O pacote ainda não está pronto para download')

    repo.findById.mockResolvedValueOnce(
      ok(createFakeWhatsAppArchive({ status: 'FAILED' })),
    )
    expect(
      expectErr(await Service.authorizeDownload(ACTOR, WS, 'a1', { now: NOW }))
        .message,
    ).toContain('falhou')

    repo.findById.mockResolvedValueOnce(
      ok(createFakeDoneWhatsAppArchive({ objectKey: null })),
    )
    expect(
      expectErr(await Service.authorizeDownload(ACTOR, WS, 'a1', { now: NOW }))
        .message,
    ).toContain('prazo de guarda')
    expect(audit).not.toHaveBeenCalled()
  })

  it('propagates not found and workspace errors', async () => {
    repo.findById.mockResolvedValueOnce(err(whatsappArchiveNotFound()))
    expectErr(
      await Service.authorizeDownload(ACTOR, WS, 'x'),
      'WHATSAPP_ARCHIVE_NOT_FOUND',
    )
    repo.findById.mockResolvedValueOnce(ok(createFakeDoneWhatsAppArchive()))
    workspaceRepo.findById.mockResolvedValueOnce(err(databaseError('w')))
    expectErr(await Service.authorizeDownload(ACTOR, WS, 'a1', { now: NOW }))
  })

  it('denies a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(await Service.authorizeDownload(ACTOR, WS, 'a1'), 'FORBIDDEN')
    expect(repo.findById).not.toHaveBeenCalled()
  })
})

describe('admin', () => {
  it('overview uses the admin download route', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([createFakeDoneWhatsAppArchive({ id: 'a1', workspaceId: WS })]),
    )
    const overview = expectOk(
      await Service.adminOverview('admin1', WS, { now: NOW }),
    )
    expect(overview.archives[0].downloadUrl).toBe(
      `/api/admin/workspaces/${WS}/whatsapp-archive/a1/download`,
    )
    expectOk(await Service.adminOverview('admin1', WS))
  })

  it('denies anyone who is not a platform admin', async () => {
    userRepo.findById.mockResolvedValue(
      ok(createFakeUser({ isPlatformAdmin: false })),
    )
    expectErr(await Service.adminOverview(ACTOR, WS), 'FORBIDDEN')
    expectErr(
      await Service.adminUpdateSettings(ACTOR, WS, { enabled: true }),
      'FORBIDDEN',
    )
    expectErr(
      await Service.adminTrigger(ACTOR, WS, { kind: 'WEEKLY' }),
      'FORBIDDEN',
    )
    expectErr(
      await Service.adminAuthorizeDownload(ACTOR, WS, 'a1'),
      'FORBIDDEN',
    )
  })

  it('turns the archive on and records it in the admin trail', async () => {
    repo.upsertSettings.mockResolvedValue(
      ok(createFakeWhatsAppArchiveSettings({ rootFolderName: 'BANCO' })),
    )
    const settings = expectOk(
      await Service.adminUpdateSettings('admin1', WS, {
        enabled: true,
        rootFolderName: 'BANCO',
      }),
    )
    expect(settings).toMatchObject({
      enabled: true,
      rootFolderName: 'BANCO',
      effectiveRootFolderName: 'BANCO',
    })
    expect(repo.upsertSettings).toHaveBeenCalledWith(WS, {
      enabled: true,
      rootFolderName: 'BANCO',
      updatedById: 'admin1',
    })
    expect(adminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'whatsapp_archive.settings',
        audit: { entity: 'whatsapp_archive_settings', action: 'update' },
        targetId: WS,
      }),
    )
  })

  it('updates only the given fields', async () => {
    repo.upsertSettings.mockResolvedValue(
      ok(createFakeWhatsAppArchiveSettings({ enabled: false })),
    )
    expectOk(
      await Service.adminUpdateSettings('admin1', WS, { enabled: false }),
    )
    expect(repo.upsertSettings).toHaveBeenLastCalledWith(WS, {
      enabled: false,
      updatedById: 'admin1',
    })
    expectOk(
      await Service.adminUpdateSettings('admin1', WS, { rootFolderName: null }),
    )
    expect(repo.upsertSettings).toHaveBeenLastCalledWith(WS, {
      rootFolderName: null,
      updatedById: 'admin1',
    })
  })

  it('settings propagate workspace and database errors', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(notFound('Workspace')))
    expectErr(
      await Service.adminUpdateSettings('admin1', WS, { enabled: true }),
      'RESOURCE_NOT_FOUND',
    )
    repo.upsertSettings.mockResolvedValueOnce(err(databaseError('u')))
    expectErr(
      await Service.adminUpdateSettings('admin1', WS, { enabled: true }),
      'DATABASE_ERROR',
    )
    expect(adminAudit).not.toHaveBeenCalled()
  })

  it('"Gerar agora" queues a package and records it', async () => {
    const dto = expectOk(
      await Service.adminTrigger(
        'admin1',
        WS,
        { kind: 'WEEKLY' },
        { now: NOW },
      ),
    )
    expect(dto).toMatchObject({ id: 'new1', status: 'QUEUED', kind: 'WEEKLY' })
    expect(repo.create.mock.calls[0][0].triggeredById).toBe('admin1')
    expect(adminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'whatsapp_archive.requested',
        meta: { archiveId: 'new1', kind: 'WEEKLY' },
      }),
    )
    expectOk(await Service.adminTrigger('admin1', WS, { kind: 'MONTHLY_FULL' }))
  })

  it('"Gerar agora" propagates refusals', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(notFound('Workspace')))
    expectErr(
      await Service.adminTrigger('admin1', WS, { kind: 'WEEKLY' }),
      'RESOURCE_NOT_FOUND',
    )
    repo.getSettings.mockResolvedValueOnce(
      ok(createFakeWhatsAppArchiveSettings({ enabled: false })),
    )
    expectErr(
      await Service.adminTrigger('admin1', WS, { kind: 'WEEKLY' }),
      'WHATSAPP_ARCHIVE_DISABLED',
    )
    expect(adminAudit).not.toHaveBeenCalled()
  })

  it('downloads and records it in the admin trail', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeDoneWhatsAppArchive({ id: 'a1', workspaceId: WS })),
    )
    expect(
      expectOk(
        await Service.adminAuthorizeDownload('admin1', WS, 'a1', { now: NOW }),
      ).key,
    ).toBe('ws1/a1.zip')
    expect(adminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'whatsapp_archive.download',
        meta: { archiveId: 'a1', kind: 'WEEKLY' },
      }),
    )
    expectOk(await Service.adminAuthorizeDownload('admin1', WS, 'a1'))
  })

  it('download refuses unfinished packages', async () => {
    repo.findById.mockResolvedValue(ok(createFakeWhatsAppArchive()))
    expectErr(
      await Service.adminAuthorizeDownload('admin1', WS, 'a1'),
      'WHATSAPP_ARCHIVE_NOT_READY',
    )
    expect(adminAudit).not.toHaveBeenCalled()
  })
})
