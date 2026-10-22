import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditMutation } from '@/lib/axiom/audit'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { UserCache } from '@/src/cache/user.cache'
import {
  databaseError,
  invitationAlreadyMember,
  invitationDuplicate,
  seatLimitReached,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { removeSearchDocument } from '@/src/lib/search/index-hooks'
import { InvitationRepository } from '@/src/repositories/invitation.repository'
import {
  MembershipRepository,
  type MembershipWithUser,
} from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { ListMembersQuerySchema } from '@/src/schemas/member.schema'
import { InvitationService } from '../invitation.service'
import { MemberService } from '../member.service'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/cache/user.cache')
vi.mock('@/src/lib/search/index-hooks')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/invitation.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('../invitation.service')

const mockedMembership = vi.mocked(MembershipRepository)
const mockedInvitation = vi.mocked(InvitationRepository)
const mockedWorkspace = vi.mocked(WorkspaceRepository)
const mockedInvitationService = vi.mocked(InvitationService)

const WS = 'ws1'

function withUser(
  overrides: Omit<Partial<MembershipWithUser>, 'user'> & {
    user?: Partial<MembershipWithUser['user']>
  },
): MembershipWithUser {
  const { user, ...membership } = overrides
  const base = createFakeMembership({ workspaceId: WS, ...membership })
  return {
    ...base,
    user: {
      id: base.userId,
      name: 'Carla',
      username: 'carla',
      email: 'carla@x.com',
      image: null,
      emailVerified: true,
      twoFactorEnabled: false,
      deletionScheduledAt: null,
      accounts: [],
      ...user,
    },
  }
}

/** First `findByUserAndWorkspace` call = actor, second = target. */
function actorAndTarget(
  actorRole: 'OWNER' | 'ADMIN' | 'MEMBER',
  target: ReturnType<typeof createFakeMembership> | null,
) {
  mockedMembership.findByUserAndWorkspace
    .mockResolvedValueOnce(
      ok(
        createFakeMembership({
          userId: 'actor',
          workspaceId: WS,
          role: actorRole,
        }),
      ),
    )
    .mockResolvedValueOnce(ok(target))
}

function query(overrides: Record<string, string> = {}) {
  return ListMembersQuerySchema.parse(overrides)
}

function mockSeats(members: number, pending: number, plan = 'FREE' as const) {
  mockedWorkspace.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: WS, activePlan: plan })),
  )
  mockedMembership.countByWorkspace.mockResolvedValue(ok(members))
  mockedInvitation.countPendingByWorkspace.mockResolvedValue(ok(pending))
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('MemberService.list()', () => {
  const ana = withUser({
    userId: 'u_ana',
    role: 'OWNER',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { name: 'Ana', username: 'ana', email: 'ana@x.com' },
  })
  const bruno = withUser({
    userId: 'u_bruno',
    role: 'VIEWER',
    createdAt: new Date('2026-03-01T00:00:00Z'),
    user: { name: 'bruno', username: 'bruno', email: 'bruno@x.com' },
  })
  const carla = withUser({
    userId: 'u_carla',
    role: 'ADMIN',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    user: { name: 'Carla', username: 'carla', email: 'carla@x.com' },
  })

  function mockDirectory() {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          userId: 'actor',
          workspaceId: WS,
          role: 'ADMIN',
        }),
      ),
    )
    mockedMembership.listByWorkspaceWithUser.mockResolvedValue(
      ok([ana, bruno, carla]),
    )
    mockSeats(3, 2)
  }

  it('returns the newest members first with seat usage by default', async () => {
    mockDirectory()

    const result = expectOk(await MemberService.list('actor', WS, query()))

    expect(result.members.map((m) => m.userId)).toEqual([
      'u_bruno',
      'u_carla',
      'u_ana',
    ])
    expect(result).toMatchObject({ total: 3, page: 1, pageSize: 20 })
    expect(result.seats).toEqual({ used: 5, limit: 12 })
  })

  it('passes search and role filters to the repository', async () => {
    mockDirectory()

    await MemberService.list(
      'actor',
      WS,
      query({ search: ' ana ', roles: 'OWNER,ADMIN' }),
    )

    expect(mockedMembership.listByWorkspaceWithUser).toHaveBeenCalledWith(WS, {
      search: 'ana',
      roles: ['OWNER', 'ADMIN'],
    })
  })

  it('sorts by name ignoring case and accents, ascending', async () => {
    mockDirectory()

    const result = expectOk(
      await MemberService.list(
        'actor',
        WS,
        query({ sortBy: 'name', sortOrder: 'asc' }),
      ),
    )

    expect(result.members.map((m) => m.name)).toEqual(['Ana', 'bruno', 'Carla'])
  })

  it('sorts by role rank, highest first', async () => {
    mockDirectory()

    const result = expectOk(
      await MemberService.list('actor', WS, query({ sortBy: 'role' })),
    )

    expect(result.members.map((m) => m.role)).toEqual([
      'OWNER',
      'ADMIN',
      'VIEWER',
    ])
  })

  it('slices the requested page', async () => {
    mockDirectory()

    const result = expectOk(
      await MemberService.list(
        'actor',
        WS,
        query({ sortBy: 'email', sortOrder: 'asc', page: '2', pageSize: '2' }),
      ),
    )

    expect(result.members.map((m) => m.email)).toEqual(['carla@x.com'])
    expect(result.total).toBe(3)
  })

  it('reports an unlimited plan as limit null', async () => {
    mockDirectory()
    mockSeats(3, 0, 'BUSINESS' as never)

    const result = expectOk(await MemberService.list('actor', WS, query()))

    expect(result.seats).toEqual({ used: 3, limit: null })
  })

  it('forbids a plain MEMBER (the directory exposes e-mails)', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          userId: 'actor',
          workspaceId: WS,
          role: 'MEMBER',
        }),
      ),
    )

    expectErr(await MemberService.list('actor', WS, query()), 'FORBIDDEN')
    expect(mockedMembership.listByWorkspaceWithUser).not.toHaveBeenCalled()
  })

  it('forbids a non-member', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await MemberService.list('actor', WS, query()), 'FORBIDDEN')
  })

  it('propagates repository errors', async () => {
    mockDirectory()
    mockedMembership.listByWorkspaceWithUser.mockResolvedValue(
      err(databaseError('boom')),
    )

    expectErr(await MemberService.list('actor', WS, query()), 'DATABASE_ERROR')
  })

  it('propagates seat usage errors', async () => {
    mockDirectory()
    mockedInvitation.countPendingByWorkspace.mockResolvedValue(
      err(databaseError('boom')),
    )

    expectErr(await MemberService.list('actor', WS, query()), 'DATABASE_ERROR')
  })
})

describe('MemberService.seatUsage()', () => {
  it('propagates a workspace lookup error', async () => {
    mockSeats(1, 0)
    mockedWorkspace.findById.mockResolvedValue(err(databaseError('boom')))

    expectErr(await MemberService.seatUsage(WS), 'DATABASE_ERROR')
  })

  it('propagates a member count error', async () => {
    mockSeats(1, 0)
    mockedMembership.countByWorkspace.mockResolvedValue(
      err(databaseError('boom')),
    )

    expectErr(await MemberService.seatUsage(WS), 'DATABASE_ERROR')
  })
})

describe('MemberService.updateRole()', () => {
  it('lets the owner promote a member and audits the change', async () => {
    actorAndTarget(
      'OWNER',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'MEMBER',
      }),
    )
    mockedMembership.updateRole.mockResolvedValue(
      ok(createFakeMembership({ userId: 'target', role: 'ADMIN' })),
    )

    const result = await MemberService.updateRole('actor', WS, 'target', {
      role: 'ADMIN',
    })

    expect(expectOk(result)).toEqual({ userId: 'target', role: 'ADMIN' })
    expect(mockedMembership.updateRole).toHaveBeenCalledWith(
      'target',
      WS,
      'ADMIN',
    )
    expect(UserCache.invalidate).toHaveBeenCalledWith('target')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'membership',
        action: 'update',
        reason: 'role_change',
        targetId: 'target',
        meta: { workspaceId: WS, from: 'MEMBER', to: 'ADMIN' },
      }),
    )
  })

  it('lets an admin change a viewer', async () => {
    actorAndTarget(
      'ADMIN',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'VIEWER',
      }),
    )
    mockedMembership.updateRole.mockResolvedValue(
      ok(createFakeMembership({ userId: 'target', role: 'MEMBER' })),
    )

    expectOk(
      await MemberService.updateRole('actor', WS, 'target', { role: 'MEMBER' }),
    )
  })

  it('forbids a plain MEMBER', async () => {
    actorAndTarget('MEMBER', null)

    expectErr(
      await MemberService.updateRole('actor', WS, 'target', { role: 'VIEWER' }),
      'FORBIDDEN',
    )
  })

  it('refuses to change the actor themselves', async () => {
    actorAndTarget('OWNER', null)

    const error = expectErr(
      await MemberService.updateRole('actor', WS, 'actor', { role: 'VIEWER' }),
      'MEMBER_PROTECTED',
    )
    expect(error.message).toContain('próprio acesso')
  })

  it('returns MEMBER_NOT_FOUND for a user outside the workspace', async () => {
    actorAndTarget('OWNER', null)

    expectErr(
      await MemberService.updateRole('actor', WS, 'ghost', { role: 'VIEWER' }),
      'MEMBER_NOT_FOUND',
    )
  })

  it('protects the owner', async () => {
    actorAndTarget(
      'ADMIN',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'OWNER',
      }),
    )

    const error = expectErr(
      await MemberService.updateRole('actor', WS, 'target', { role: 'VIEWER' }),
      'MEMBER_PROTECTED',
    )
    expect(error.message).toContain('dono')
  })

  it('lets only the owner change an admin', async () => {
    actorAndTarget(
      'ADMIN',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'ADMIN',
      }),
    )

    const error = expectErr(
      await MemberService.updateRole('actor', WS, 'target', { role: 'VIEWER' }),
      'MEMBER_PROTECTED',
    )
    expect(error.message).toContain('administradores')
    expect(mockedMembership.updateRole).not.toHaveBeenCalled()
  })

  it('propagates a target lookup error', async () => {
    mockedMembership.findByUserAndWorkspace
      .mockResolvedValueOnce(
        ok(
          createFakeMembership({
            userId: 'actor',
            workspaceId: WS,
            role: 'OWNER',
          }),
        ),
      )
      .mockResolvedValueOnce(err(databaseError('boom')))

    expectErr(
      await MemberService.updateRole('actor', WS, 'target', { role: 'VIEWER' }),
      'DATABASE_ERROR',
    )
  })

  it('propagates an update error without auditing', async () => {
    actorAndTarget(
      'OWNER',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'MEMBER',
      }),
    )
    mockedMembership.updateRole.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await MemberService.updateRole('actor', WS, 'target', { role: 'VIEWER' }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('MemberService.remove()', () => {
  it('removes the member, drops caches and search, and audits', async () => {
    actorAndTarget(
      'OWNER',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'ADMIN',
      }),
    )
    mockedMembership.remove.mockResolvedValue(ok(undefined))

    const result = await MemberService.remove('actor', WS, 'target')

    expect(expectOk(result)).toEqual({ userId: 'target' })
    expect(mockedMembership.remove).toHaveBeenCalledWith('target', WS)
    expect(UserCache.invalidate).toHaveBeenCalledWith('target')
    expect(removeSearchDocument).toHaveBeenCalledWith('member', WS, 'target')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'membership',
        action: 'delete',
        targetId: 'target',
        meta: { workspaceId: WS, role: 'ADMIN' },
      }),
    )
  })

  it('refuses to remove the owner', async () => {
    actorAndTarget(
      'OWNER',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'OWNER',
      }),
    )

    expectErr(
      await MemberService.remove('actor', WS, 'target'),
      'MEMBER_PROTECTED',
    )
    expect(mockedMembership.remove).not.toHaveBeenCalled()
  })

  it('refuses to let a member leave through this endpoint', async () => {
    actorAndTarget('ADMIN', null)

    expectErr(
      await MemberService.remove('actor', WS, 'actor'),
      'MEMBER_PROTECTED',
    )
  })

  it('propagates a removal error', async () => {
    actorAndTarget(
      'ADMIN',
      createFakeMembership({
        userId: 'target',
        workspaceId: WS,
        role: 'VIEWER',
      }),
    )
    mockedMembership.remove.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await MemberService.remove('actor', WS, 'target'),
      'DATABASE_ERROR',
    )
    expect(UserCache.invalidate).not.toHaveBeenCalled()
  })
})

describe('MemberService.import()', () => {
  function privilegedActor() {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          userId: 'actor',
          workspaceId: WS,
          role: 'ADMIN',
        }),
      ),
    )
  }

  it('invites each row and classifies the outcome', async () => {
    privilegedActor()
    mockedInvitationService.create
      .mockResolvedValueOnce(ok({} as never))
      .mockResolvedValueOnce(err(invitationDuplicate()))
      .mockResolvedValueOnce(err(invitationAlreadyMember()))
      .mockResolvedValueOnce(err(seatLimitReached()))

    const result = expectOk(
      await MemberService.import('actor', WS, [
        { email: 'a@x.com', role: 'ADMIN' },
        { email: 'b@x.com', role: 'MEMBER' },
        { email: 'c@x.com', role: 'MEMBER' },
        { email: 'd@x.com', role: 'VIEWER' },
      ]),
    )

    expect(result).toMatchObject({ invited: 1, skipped: 2, errors: 1 })
    expect(result.rows).toEqual([
      { row: 1, email: 'a@x.com', status: 'invited' },
      {
        row: 2,
        email: 'b@x.com',
        status: 'skipped',
        reason: invitationDuplicate().message,
      },
      {
        row: 3,
        email: 'c@x.com',
        status: 'skipped',
        reason: invitationAlreadyMember().message,
      },
      {
        row: 4,
        email: 'd@x.com',
        status: 'error',
        reason: seatLimitReached().message,
      },
    ])
    expect(mockedInvitationService.create).toHaveBeenNthCalledWith(
      1,
      'actor',
      WS,
      { email: 'a@x.com', role: 'ADMIN' },
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'invitation',
        reason: 'csv_import',
        meta: { workspaceId: WS, total: 4, invited: 1, skipped: 2, errors: 1 },
      }),
    )
  })

  it('forbids a plain MEMBER before sending anything', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          userId: 'actor',
          workspaceId: WS,
          role: 'MEMBER',
        }),
      ),
    )

    expectErr(
      await MemberService.import('actor', WS, [
        { email: 'a@x.com', role: 'MEMBER' },
      ]),
      'FORBIDDEN',
    )
    expect(mockedInvitationService.create).not.toHaveBeenCalled()
  })
})
