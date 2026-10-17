import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeIntegrationGrant,
  createFakeWorkspaceIntegrationGrantRow,
} from '@/src/__tests__/factories/integration-grant.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/integration-grant.repository')
vi.mock('@/src/cache/mcp-usage.cache', () => ({
  McpUsageCache: { readWorkspace: vi.fn(), recordCall: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { McpUsageCache } from '@/src/cache/mcp-usage.cache'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceIntegrationGrantService } from '../workspace-integration-grant.service'

const grants = vi.mocked(IntegrationGrantRepository)
const memberships = vi.mocked(MembershipRepository)
const usage = vi.mocked(McpUsageCache)
const audit = vi.mocked(auditMutation)

const ADMIN = 'admin-1'
const WORKSPACE = 'ws-1'
const DB = databaseError('boom')

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ userId: ADMIN, workspaceId: WORKSPACE, role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('ADMIN')
})

describe('WorkspaceIntegrationGrantService.list', () => {
  it('lists every member grant and one summary per app with usage', async () => {
    const mine = createFakeWorkspaceIntegrationGrantRow({
      id: 'g1',
      clientId: 'claude',
      userId: ADMIN,
      workspaceId: WORKSPACE,
    })
    const theirs = createFakeWorkspaceIntegrationGrantRow({
      id: 'g2',
      clientId: 'claude',
      userId: 'member-2',
      workspaceId: WORKSPACE,
    })
    grants.listActiveByWorkspace.mockResolvedValue(ok([mine, theirs]))
    usage.readWorkspace.mockResolvedValue({
      byClient: new Map([['claude', { last7Days: 5, last30Days: 12 }]]),
      byGrant: new Map([['g2', { last7Days: 5, last30Days: 7 }]]),
    })
    const now = new Date('2026-10-17T12:00:00Z')

    const result = expectOk(
      await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE, now),
    )

    expect(grants.listActiveByWorkspace).toHaveBeenCalledWith(WORKSPACE)
    expect(usage.readWorkspace).toHaveBeenCalledWith(WORKSPACE, now)
    expect(result.grants.map((g) => [g.id, g.usage.last30Days])).toEqual([
      ['g1', 0],
      ['g2', 7],
    ])
    expect(result.clients).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ clientId: 'claude' }),
        members: 2,
        usage: { last7Days: 5, last30Days: 12 },
      }),
    ])
  })

  it('allows the owner and uses the current time by default', async () => {
    asRole('OWNER')
    grants.listActiveByWorkspace.mockResolvedValue(ok([]))
    usage.readWorkspace.mockResolvedValue({
      byClient: new Map(),
      byGrant: new Map(),
    })
    expect(
      expectOk(await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE)),
    ).toEqual({ grants: [], clients: [] })
    expect(usage.readWorkspace.mock.calls[0][1]).toBeInstanceOf(Date)
  })

  it('refuses members, viewers and non-members', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      asRole(role)
      expectErr(
        await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE),
        'FORBIDDEN',
      )
    }
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE),
      'FORBIDDEN',
    )
    expect(grants.listActiveByWorkspace).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    grants.listActiveByWorkspace.mockResolvedValue(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE),
      'DATABASE_ERROR',
    )
    memberships.findByUserAndWorkspace.mockResolvedValue(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.list(ADMIN, WORKSPACE),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationGrantService.revoke', () => {
  it("revokes any member's grant of the workspace and audits", async () => {
    const grant = createFakeIntegrationGrant({
      id: 'g1',
      workspaceId: WORKSPACE,
      userId: 'member-2',
      clientId: 'claude',
    })
    grants.findById.mockResolvedValue(ok(grant))
    grants.revoke.mockResolvedValue(ok({ ...grant, revokedAt: new Date() }))

    expect(
      expectOk(
        await WorkspaceIntegrationGrantService.revoke(ADMIN, WORKSPACE, 'g1'),
      ),
    ).toEqual({ id: 'g1' })
    expect(grants.revoke).toHaveBeenCalledWith('g1', expect.any(Date))
    expect(audit).toHaveBeenCalledWith({
      entity: 'integration_grant',
      action: 'revoke',
      actorId: ADMIN,
      targetId: 'g1',
      meta: {
        workspaceId: WORKSPACE,
        target: 'grant',
        clientId: 'claude',
        holderId: 'member-2',
      },
    })
  })

  it('treats a missing, revoked or other-workspace grant as not found', async () => {
    grants.findById.mockResolvedValueOnce(err(notFound('IntegrationGrant')))
    grants.findById.mockResolvedValueOnce(
      ok(
        createFakeIntegrationGrant({
          workspaceId: WORKSPACE,
          revokedAt: new Date(),
        }),
      ),
    )
    grants.findById.mockResolvedValueOnce(
      ok(createFakeIntegrationGrant({ workspaceId: 'ws-other' })),
    )
    for (let i = 0; i < 3; i++) {
      expectErr(
        await WorkspaceIntegrationGrantService.revoke(ADMIN, WORKSPACE, 'g'),
        'INTEGRATION_GRANT_NOT_FOUND',
      )
    }
    expect(grants.revoke).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('refuses a plain member', async () => {
    asRole('MEMBER')
    expectErr(
      await WorkspaceIntegrationGrantService.revoke(ADMIN, WORKSPACE, 'g'),
      'FORBIDDEN',
    )
    expect(grants.findById).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    grants.findById.mockResolvedValueOnce(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.revoke(ADMIN, WORKSPACE, 'g'),
      'DATABASE_ERROR',
    )
    grants.findById.mockResolvedValueOnce(
      ok(createFakeIntegrationGrant({ workspaceId: WORKSPACE })),
    )
    grants.revoke.mockResolvedValueOnce(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.revoke(ADMIN, WORKSPACE, 'g'),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('WorkspaceIntegrationGrantService bulk revocation', () => {
  it("revokes all of one member's grants and audits", async () => {
    grants.listActiveIdsByWorkspace.mockResolvedValue(ok(['g1', 'g2']))
    grants.revokeMany.mockResolvedValue(ok(2))

    expect(
      expectOk(
        await WorkspaceIntegrationGrantService.revokeByMember(
          ADMIN,
          WORKSPACE,
          'member-2',
        ),
      ),
    ).toEqual({ revoked: 2 })
    expect(grants.listActiveIdsByWorkspace).toHaveBeenCalledWith(WORKSPACE, {
      userId: 'member-2',
    })
    expect(grants.revokeMany).toHaveBeenCalledWith(
      ['g1', 'g2'],
      expect.any(Date),
    )
    expect(audit).toHaveBeenCalledWith({
      entity: 'integration_grant',
      action: 'revoke',
      actorId: ADMIN,
      targetId: 'member-2',
      meta: {
        workspaceId: WORKSPACE,
        target: 'member',
        grantIds: ['g1', 'g2'],
        revoked: 2,
      },
    })
  })

  it("revokes all of one app's grants", async () => {
    grants.listActiveIdsByWorkspace.mockResolvedValue(ok(['g3']))
    grants.revokeMany.mockResolvedValue(ok(1))

    expect(
      expectOk(
        await WorkspaceIntegrationGrantService.revokeByClient(
          ADMIN,
          WORKSPACE,
          'claude',
        ),
      ),
    ).toEqual({ revoked: 1 })
    expect(grants.listActiveIdsByWorkspace).toHaveBeenCalledWith(WORKSPACE, {
      clientId: 'claude',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'claude',
        meta: expect.objectContaining({ target: 'client', revoked: 1 }),
      }),
    )
  })

  it('answers zero without auditing when nothing is active', async () => {
    grants.listActiveIdsByWorkspace.mockResolvedValue(ok([]))
    grants.revokeMany.mockResolvedValue(ok(0))
    expect(
      expectOk(
        await WorkspaceIntegrationGrantService.revokeByClient(
          ADMIN,
          WORKSPACE,
          'nobody',
        ),
      ),
    ).toEqual({ revoked: 0 })
    expect(audit).not.toHaveBeenCalled()
  })

  it('refuses a viewer and propagates database errors', async () => {
    asRole('VIEWER')
    expectErr(
      await WorkspaceIntegrationGrantService.revokeByMember(
        ADMIN,
        WORKSPACE,
        'u',
      ),
      'FORBIDDEN',
    )
    expect(grants.listActiveIdsByWorkspace).not.toHaveBeenCalled()

    asRole('OWNER')
    grants.listActiveIdsByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.revokeByMember(
        ADMIN,
        WORKSPACE,
        'u',
      ),
      'DATABASE_ERROR',
    )
    grants.listActiveIdsByWorkspace.mockResolvedValueOnce(ok(['g1']))
    grants.revokeMany.mockResolvedValueOnce(err(DB))
    expectErr(
      await WorkspaceIntegrationGrantService.revokeByClient(
        ADMIN,
        WORKSPACE,
        'c',
      ),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})
