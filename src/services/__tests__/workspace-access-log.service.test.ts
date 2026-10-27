import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { createFakeWorkspaceAccessLog } from '@/src/__tests__/factories/workspace-access-log.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository', () => ({
  WorkspaceRepository: { findById: vi.fn() },
}))
vi.mock('@/src/repositories/workspace-access-log.repository', () => ({
  WorkspaceAccessLogRepository: {
    listPage: vi.fn(),
    listBatch: vi.fn(),
    count: vi.fn(),
    deleteOlderThan: vi.fn(),
  },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceAccessLogRepository } from '@/src/repositories/workspace-access-log.repository'
import {
  ACCESS_LOG_EXPORT_BATCH,
  ACCESS_LOG_EXPORT_MAX_ROWS,
  resolveAccessLogRange,
  WorkspaceAccessLogService,
} from '../workspace-access-log.service'

const membershipRepo = vi.mocked(MembershipRepository)
const userRepo = vi.mocked(UserRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const repo = vi.mocked(WorkspaceAccessLogRepository)
const audit = vi.mocked(auditMutation)

const ACTOR = 'u_ana'
const WS = 'ws_1'
// 10:00 in São Paulo.
const NOW = new Date('2026-10-27T13:00:00.000Z')
const LIST = { page: 1, pageSize: 50 }

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: ACTOR, workspaceId: WS })),
  )
}

function asPlatformAdmin(email = 'ana@stratustelecom.com.br', flag = true) {
  userRepo.findById.mockResolvedValue(
    ok(createFakeUser({ id: ACTOR, email, isPlatformAdmin: flag })),
  )
}

async function collect(chunks: AsyncGenerator<string>): Promise<string> {
  let text = ''
  for await (const chunk of chunks) text += chunk
  return text
}

beforeEach(() => {
  vi.clearAllMocks()
  workspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: WS, allowedIps: ['200.1.2.0/24'] })),
  )
  repo.listPage.mockResolvedValue(ok({ rows: [], total: 0 }))
  repo.count.mockResolvedValue(ok(0))
  repo.listBatch.mockResolvedValue(ok([]))
})

describe('resolveAccessLogRange', () => {
  it('defaults to the last 30 São Paulo days, today included', () => {
    const range = resolveAccessLogRange({}, NOW)
    expect(range).toEqual({
      fromKey: '2026-09-28',
      toKey: '2026-10-27',
      from: new Date('2026-09-28T03:00:00.000Z'),
      to: new Date('2026-10-28T03:00:00.000Z'),
    })
  })

  it('uses today in São Paulo even when UTC already turned the day', () => {
    const late = new Date('2026-10-28T02:00:00.000Z') // 23:00 on the 27th
    expect(resolveAccessLogRange({}, late).toKey).toBe('2026-10-27')
  })

  it('fills the missing bound', () => {
    expect(resolveAccessLogRange({ from: '2026-10-01' }, NOW)).toMatchObject({
      fromKey: '2026-10-01',
      toKey: '2026-10-27',
    })
    expect(resolveAccessLogRange({ from: '2026-11-05' }, NOW)).toMatchObject({
      fromKey: '2026-11-05',
      toKey: '2026-11-05',
    })
    expect(resolveAccessLogRange({ to: '2026-10-10' }, NOW)).toMatchObject({
      fromKey: '2026-09-11',
      toKey: '2026-10-10',
    })
  })
})

describe('WorkspaceAccessLogService.list', () => {
  it('returns the page, the period and the allowlist to an OWNER', async () => {
    asRole('OWNER')
    const row = createFakeWorkspaceAccessLog({ workspaceId: WS })
    repo.listPage.mockResolvedValue(ok({ rows: [row], total: 51 }))

    const result = expectOk(
      await WorkspaceAccessLogService.list(
        ACTOR,
        WS,
        { ...LIST, page: 2, outcome: 'BLOCKED', surface: 'API', user: 'ana' },
        NOW,
      ),
    )

    expect(result).toMatchObject({
      total: 51,
      page: 2,
      pageSize: 50,
      period: {
        from: '2026-09-28',
        to: '2026-10-27',
        timezone: 'America/Sao_Paulo',
      },
      allowedIps: ['200.1.2.0/24'],
    })
    expect(result.items).toEqual([
      expect.objectContaining({ id: row.id, ip: '200.1.2.3' }),
    ])
    expect(repo.listPage).toHaveBeenCalledWith(
      {
        workspaceId: WS,
        from: new Date('2026-09-28T03:00:00.000Z'),
        to: new Date('2026-10-28T03:00:00.000Z'),
        outcome: 'BLOCKED',
        surface: 'API',
        user: 'ana',
      },
      { skip: 50, take: 50 },
    )
  })

  it('works for an ADMIN', async () => {
    asRole('ADMIN')
    expectOk(await WorkspaceAccessLogService.list(ACTOR, WS, LIST, NOW))
  })

  it.each(['MEMBER', 'VIEWER'] as const)('forbids a %s', async (role) => {
    asRole(role)
    expectErr(
      await WorkspaceAccessLogService.list(ACTOR, WS, LIST, NOW),
      'FORBIDDEN',
    )
    expect(repo.listPage).not.toHaveBeenCalled()
  })

  it('forbids a non-member (another workspace)', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WorkspaceAccessLogService.list(ACTOR, 'ws_other', LIST, NOW),
      'FORBIDDEN',
    )
    expect(workspaceRepo.findById).not.toHaveBeenCalled()
  })

  it('propagates a database error from the page', async () => {
    asRole('OWNER')
    repo.listPage.mockResolvedValue(err(databaseError('db down')))
    expectErr(
      await WorkspaceAccessLogService.list(ACTOR, WS, LIST, NOW),
      'DATABASE_ERROR',
    )
  })

  it('propagates a failure loading the workspace', async () => {
    asRole('OWNER')
    workspaceRepo.findById.mockResolvedValue(err(databaseError('db down')))
    expectErr(
      await WorkspaceAccessLogService.list(ACTOR, WS, LIST, NOW),
      'DATABASE_ERROR',
    )
  })

  it('uses the current clock by default', async () => {
    asRole('OWNER')
    expectOk(await WorkspaceAccessLogService.list(ACTOR, WS, LIST))
  })
})

describe('WorkspaceAccessLogService.adminList', () => {
  it('serves the global admin without a membership', async () => {
    asPlatformAdmin()
    expectOk(await WorkspaceAccessLogService.adminList(ACTOR, WS, LIST, NOW))
    expect(membershipRepo.findByUserAndWorkspace).not.toHaveBeenCalled()
  })

  it('forbids someone who is not a platform admin', async () => {
    asPlatformAdmin('ana@acme.com.br')
    expectErr(
      await WorkspaceAccessLogService.adminList(ACTOR, WS, LIST, NOW),
      'FORBIDDEN',
    )
    asPlatformAdmin('ana@stratustelecom.com.br', false)
    expectErr(
      await WorkspaceAccessLogService.adminList(ACTOR, WS, LIST),
      'FORBIDDEN',
    )
  })

  it('answers RESOURCE_NOT_FOUND for a missing workspace', async () => {
    asPlatformAdmin()
    workspaceRepo.findById.mockResolvedValue(err(notFound('Workspace')))
    expectErr(
      await WorkspaceAccessLogService.adminList(ACTOR, 'nope', LIST, NOW),
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('WorkspaceAccessLogService.exportCsv', () => {
  it('streams the header and every batch in order, and audits', async () => {
    asRole('OWNER')
    const first = Array.from({ length: ACCESS_LOG_EXPORT_BATCH }, (_, i) =>
      createFakeWorkspaceAccessLog({
        workspaceId: WS,
        createdAt: new Date(NOW.getTime() + i * 1000),
      }),
    )
    const tail = [createFakeWorkspaceAccessLog({ workspaceId: WS })]
    repo.count.mockResolvedValue(ok(first.length + 1))
    repo.listBatch
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValueOnce(ok(tail))

    const result = expectOk(
      await WorkspaceAccessLogService.exportCsv(
        ACTOR,
        WS,
        { from: '2026-10-01', to: '2026-10-27', outcome: 'ALLOWED' },
        NOW,
      ),
    )
    expect(result.filename).toBe('acessos-2026-10-01_2026-10-27.csv')
    expect(result.rows).toBe(ACCESS_LOG_EXPORT_BATCH + 1)

    const csv = await collect(result.chunks)
    const lines = csv.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe(
      '﻿Data e hora (São Paulo),Resultado,Canal,Nome,E-mail,ID do usuário,IP,Caminho,Navegador (user agent)',
    )
    expect(lines).toHaveLength(ACCESS_LOG_EXPORT_BATCH + 2)

    const last = first[first.length - 1]
    expect(repo.listBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceId: WS, outcome: 'ALLOWED' }),
      ACCESS_LOG_EXPORT_BATCH,
      { createdAt: last.createdAt, id: last.id },
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'workspace_access_log',
        action: 'download',
        actorId: ACTOR,
        targetId: WS,
        meta: expect.objectContaining({
          door: 'workspace',
          from: '2026-10-01',
          to: '2026-10-27',
          outcome: 'ALLOWED',
          surface: null,
          userFilter: null,
          rows: ACCESS_LOG_EXPORT_BATCH + 1,
        }),
      }),
    )
  })

  it('stops after an empty batch', async () => {
    asRole('ADMIN')
    const result = expectOk(
      await WorkspaceAccessLogService.exportCsv(ACTOR, WS, { user: 'x' }),
    )
    const csv = await collect(result.chunks)
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ userFilter: 'set' }),
      }),
    )
  })

  it('refuses a range over the cap before streaming', async () => {
    asRole('OWNER')
    repo.count.mockResolvedValue(ok(ACCESS_LOG_EXPORT_MAX_ROWS + 1))
    const error = expectErr(
      await WorkspaceAccessLogService.exportCsv(ACTOR, WS, {}, NOW),
      'VALIDATION_ERROR',
    )
    expect(error.details).toEqual({
      total: ACCESS_LOG_EXPORT_MAX_ROWS + 1,
      max: ACCESS_LOG_EXPORT_MAX_ROWS,
    })
    expect(audit).not.toHaveBeenCalled()
  })

  it('propagates a failed count', async () => {
    asRole('OWNER')
    repo.count.mockResolvedValue(err(databaseError('db down')))
    expectErr(
      await WorkspaceAccessLogService.exportCsv(ACTOR, WS, {}, NOW),
      'DATABASE_ERROR',
    )
  })

  it('aborts the stream when a batch fails mid-way', async () => {
    asRole('OWNER')
    repo.listBatch.mockResolvedValue(err(databaseError('db down')))
    const result = expectOk(
      await WorkspaceAccessLogService.exportCsv(ACTOR, WS, {}, NOW),
    )
    await expect(collect(result.chunks)).rejects.toThrow('db down')
    expect(logger.error).toHaveBeenCalledWith(
      'workspace.access_log.export_failed',
      expect.objectContaining({ workspaceId: WS }),
    )
  })

  it('forbids a MEMBER and audits nothing', async () => {
    asRole('MEMBER')
    expectErr(
      await WorkspaceAccessLogService.exportCsv(ACTOR, WS, {}, NOW),
      'FORBIDDEN',
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('serves the global admin through the admin door', async () => {
    asPlatformAdmin()
    const result = expectOk(
      await WorkspaceAccessLogService.adminExportCsv(ACTOR, WS, {}, NOW),
    )
    await collect(result.chunks)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ door: 'admin' }),
      }),
    )
    expectOk(await WorkspaceAccessLogService.adminExportCsv(ACTOR, WS, {}))
  })
})

describe('WorkspaceAccessLogService.pruneOlderThan', () => {
  it('delegates to the repository', async () => {
    repo.deleteOlderThan.mockResolvedValue(ok(4))
    const cutoff = new Date('2021-10-27T00:00:00.000Z')
    expect(
      expectOk(await WorkspaceAccessLogService.pruneOlderThan(cutoff)),
    ).toBe(4)
    expect(repo.deleteOlderThan).toHaveBeenCalledWith(cutoff)
  })
})
