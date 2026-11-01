import { describe, expect, it, vi } from 'vitest'
import {
  seedCrmScheduledPost,
  seedCrmSocialConnection,
} from '@/src/__tests__/factories/crm-social.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmScheduledPostMediaRepository,
  CrmScheduledPostRepository,
  CrmScheduledPostTargetRepository,
  CrmSocialConnectionRepository,
} from '../crm-social.repository'

describe('CrmSocialConnectionRepository', () => {
  describe('create()', () => {
    it('should return CRM_SOCIAL_CONNECTION_CONFLICT on duplicate (platform, externalAccountId)', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmSocialConnection(workspace.id, user.id, {
        platform: 'INSTAGRAM',
        externalAccountId: 'acc-1',
      })

      const result = await CrmSocialConnectionRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        platform: 'INSTAGRAM',
        externalAccountId: 'acc-1',
      })

      expectErr(result, 'CRM_SOCIAL_CONNECTION_CONFLICT')
    })

    it('should allow a second account of the same platform with a different externalAccountId', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmSocialConnection(workspace.id, user.id, {
        platform: 'INSTAGRAM',
        externalAccountId: 'acc-1',
      })

      const result = await CrmSocialConnectionRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        platform: 'INSTAGRAM',
        externalAccountId: 'acc-2',
      })

      expectOk(result)
    })
  })

  describe('findPrimaryByPlatform()', () => {
    it('should return null when there is no connection', async () => {
      const workspace = await seedWorkspace()
      const result = expectOk(
        await CrmSocialConnectionRepository.findPrimaryByPlatform(
          workspace.id,
          'TIKTOK',
        ),
      )
      expect(result).toBeNull()
    })
  })

  describe('upsertOAuthConnection()', () => {
    it('should persist two accounts of the same platform as separate rows', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const base = {
        workspaceId: workspace.id,
        createdById: user.id,
        platform: 'FACEBOOK' as const,
        accessToken: 'enc:token',
        isPrimary: false,
      }

      await CrmSocialConnectionRepository.upsertOAuthConnection({
        ...base,
        externalAccountId: 'page-1',
      })
      await CrmSocialConnectionRepository.upsertOAuthConnection({
        ...base,
        externalAccountId: 'page-2',
      })

      const all = expectOk(
        await CrmSocialConnectionRepository.listByPlatform(
          workspace.id,
          'FACEBOOK',
        ),
      )
      expect(all).toHaveLength(2)
      expect(all.map((c) => c.externalAccountId).sort()).toEqual([
        'page-1',
        'page-2',
      ])
    })

    it('should upsert (not duplicate) when reconnecting the same account', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const base = {
        workspaceId: workspace.id,
        createdById: user.id,
        platform: 'FACEBOOK' as const,
        externalAccountId: 'page-1',
        isPrimary: false,
      }

      await CrmSocialConnectionRepository.upsertOAuthConnection({
        ...base,
        accessToken: 'enc:token-1',
      })
      await CrmSocialConnectionRepository.upsertOAuthConnection({
        ...base,
        accessToken: 'enc:token-2',
      })

      const all = expectOk(
        await CrmSocialConnectionRepository.listByPlatform(
          workspace.id,
          'FACEBOOK',
        ),
      )
      expect(all).toHaveLength(1)
      expect(all[0].accessToken).toBe('enc:token-2')
    })
  })

  describe('setPrimary()', () => {
    it('should leave exactly one primary per platform group', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const first = await seedCrmSocialConnection(workspace.id, user.id, {
        platform: 'FACEBOOK',
        externalAccountId: 'page-1',
      })
      const second = await seedCrmSocialConnection(workspace.id, user.id, {
        platform: 'FACEBOOK',
        externalAccountId: 'page-2',
      })

      await CrmSocialConnectionRepository.setPrimary(
        workspace.id,
        'FACEBOOK',
        first.id,
      )
      const afterFirst = expectOk(
        await CrmSocialConnectionRepository.listByPlatform(
          workspace.id,
          'FACEBOOK',
        ),
      )
      expect(afterFirst.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([
        first.id,
      ])

      await CrmSocialConnectionRepository.setPrimary(
        workspace.id,
        'FACEBOOK',
        second.id,
      )
      const afterSecond = expectOk(
        await CrmSocialConnectionRepository.listByPlatform(
          workspace.id,
          'FACEBOOK',
        ),
      )
      expect(afterSecond.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([
        second.id,
      ])
    })
  })
})

describe('CrmScheduledPostRepository', () => {
  describe('create()', () => {
    it('should default status to SCHEDULED when scheduledFor is set', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])

      const post = expectOk(
        await CrmScheduledPostRepository.create({
          workspaceId: workspace.id,
          createdById: user.id,
          content: 'Olá',
          status: 'SCHEDULED',
          scheduledFor: new Date(Date.now() + 60_000),
        }),
      )
      expect(post.status).toBe('SCHEDULED')
    })
  })

  describe('findById()', () => {
    it('should include targets', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const post = await seedCrmScheduledPost(workspace.id, user.id)
      await CrmScheduledPostTargetRepository.createMany(post.id, [
        'INSTAGRAM',
        'FACEBOOK',
      ])

      const found = expectOk(
        await CrmScheduledPostRepository.findById(post.id, workspace.id),
      )
      expect(found.targets).toHaveLength(2)
    })
  })
})

describe('CrmSocialConnectionRepository — reads and mutations', () => {
  it('should list only the workspace connections, newest first', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const older = await seedCrmSocialConnection(workspace.id, user.id, {
      externalAccountId: 'old',
    })
    await prisma.crmSocialConnection.update({
      where: { id: older.id },
      data: { createdAt: new Date('2020-01-01') },
    })
    const newer = await seedCrmSocialConnection(workspace.id, user.id, {
      externalAccountId: 'new',
    })
    await seedCrmSocialConnection(other.id, user.id)

    const list = expectOk(
      await CrmSocialConnectionRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((c) => c.id)).toEqual([newer.id, older.id])
  })

  it('should find by id scoped to the workspace', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const connection = await seedCrmSocialConnection(workspace.id, user.id)

    expect(
      expectOk(
        await CrmSocialConnectionRepository.findById(
          connection.id,
          workspace.id,
        ),
      ).id,
    ).toBe(connection.id)
    expectErr(
      await CrmSocialConnectionRepository.findById(connection.id, other.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should list by platform with the primary first', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const a = await seedCrmSocialConnection(workspace.id, user.id, {
      platform: 'TIKTOK',
      externalAccountId: 'a',
    })
    const b = await seedCrmSocialConnection(workspace.id, user.id, {
      platform: 'TIKTOK',
      externalAccountId: 'b',
    })
    await prisma.crmSocialConnection.update({
      where: { id: a.id },
      data: { createdAt: new Date('2020-01-01') },
    })
    await seedCrmSocialConnection(workspace.id, user.id, {
      platform: 'INSTAGRAM',
      externalAccountId: 'c',
    })
    expectOk(
      await CrmSocialConnectionRepository.setPrimary(
        workspace.id,
        'TIKTOK',
        a.id,
      ),
    )

    const list = expectOk(
      await CrmSocialConnectionRepository.listByPlatform(
        workspace.id,
        'TIKTOK',
      ),
    )
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
    expect(
      expectOk(
        await CrmSocialConnectionRepository.findPrimaryByPlatform(
          workspace.id,
          'TIKTOK',
        ),
      )?.id,
    ).toBe(a.id)
  })

  it('should return DATABASE_ERROR when creating for an unknown workspace', async () => {
    const user = await seedUser()
    expectErr(
      await CrmSocialConnectionRepository.create({
        workspaceId: 'missing',
        createdById: user.id,
        platform: 'INSTAGRAM',
        externalAccountId: 'x',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should set the status and update tokens (reconnecting the account)', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const connection = await seedCrmSocialConnection(workspace.id, user.id)

    const expired = expectOk(
      await CrmSocialConnectionRepository.setStatus(connection.id, 'EXPIRED'),
    )
    expect(expired.status).toBe('EXPIRED')

    const expiresAt = new Date(Date.now() + 3_600_000)
    const refreshed = expectOk(
      await CrmSocialConnectionRepository.updateTokens(connection.id, {
        accessToken: 'enc:new',
        refreshToken: 'enc:refresh',
        tokenExpiresAt: expiresAt,
        scope: 'read',
      }),
    )
    expect(refreshed.status).toBe('CONNECTED')
    expect(refreshed.accessToken).toBe('enc:new')
    expect(refreshed.tokenExpiresAt?.getTime()).toBe(expiresAt.getTime())
  })

  it('should return DATABASE_ERROR when mutating an unknown connection', async () => {
    const workspace = await seedWorkspace()
    expectErr(
      await CrmSocialConnectionRepository.setStatus('missing', 'REVOKED'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.updateTokens('missing', {
        accessToken: 'x',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.setPrimary(
        workspace.id,
        'INSTAGRAM',
        'missing',
      ),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.remove('missing'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.createMetricSnapshot('missing', {
        followersCount: 1,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should return DATABASE_ERROR when the OAuth upsert references an unknown user', async () => {
    const workspace = await seedWorkspace()
    expectErr(
      await CrmSocialConnectionRepository.upsertOAuthConnection({
        workspaceId: workspace.id,
        createdById: 'missing',
        platform: 'GOOGLE_ADS',
        externalAccountId: 'x',
        accessToken: 'enc',
        isPrimary: true,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should remove a connection', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const connection = await seedCrmSocialConnection(workspace.id, user.id)

    expectOk(await CrmSocialConnectionRepository.remove(connection.id))
    expectErr(
      await CrmSocialConnectionRepository.findById(connection.id, workspace.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should record metric snapshots and list them oldest first since a date', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const connection = await seedCrmSocialConnection(workspace.id, user.id)
    const old = expectOk(
      await CrmSocialConnectionRepository.createMetricSnapshot(connection.id, {
        followersCount: 10,
      }),
    )
    await prisma.crmSocialConnectionMetricSnapshot.update({
      where: { id: old.id },
      data: { capturedAt: new Date('2020-01-01') },
    })
    const first = expectOk(
      await CrmSocialConnectionRepository.createMetricSnapshot(connection.id, {
        followersCount: 20,
        postsCount: 3,
      }),
    )
    const second = expectOk(
      await CrmSocialConnectionRepository.createMetricSnapshot(connection.id, {
        followersCount: 30,
      }),
    )

    const series = expectOk(
      await CrmSocialConnectionRepository.listMetricSnapshotsSince(
        connection.id,
        new Date('2021-01-01'),
      ),
    )
    expect(series.map((s) => s.id)).toEqual([first.id, second.id])
    expect(series[0].postsCount).toBe(3)
  })

  it('should return DATABASE_ERROR when read queries throw', async () => {
    vi.spyOn(prisma.crmSocialConnection, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma.crmSocialConnection, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(
      prisma.crmSocialConnectionMetricSnapshot,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await CrmSocialConnectionRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.listByPlatform('w', 'INSTAGRAM'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.findById('x', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.findPrimaryByPlatform(
        'w',
        'INSTAGRAM',
      ),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmSocialConnectionRepository.listMetricSnapshotsSince(
        'x',
        new Date(),
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmScheduledPostRepository — lifecycle', () => {
  it('should list non-deleted workspace posts newest first with relations', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const older = await seedCrmScheduledPost(workspace.id, user.id)
    await prisma.crmScheduledPost.update({
      where: { id: older.id },
      data: { createdAt: new Date('2020-01-01') },
    })
    const newer = await seedCrmScheduledPost(workspace.id, user.id)
    await seedCrmScheduledPost(workspace.id, user.id, { deletedAt: new Date() })
    await seedCrmScheduledPost(other.id, user.id)

    const list = expectOk(
      await CrmScheduledPostRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((p) => p.id)).toEqual([newer.id, older.id])
    expect(list[0].targets).toEqual([])
    expect(list[0].media).toEqual([])
  })

  it('should return NOT_FOUND for another workspace or a soft-deleted post', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const post = await seedCrmScheduledPost(workspace.id, user.id)
    expectErr(
      await CrmScheduledPostRepository.findById(post.id, other.id),
      'RESOURCE_NOT_FOUND',
    )

    expectOk(await CrmScheduledPostRepository.softDelete(post.id))
    expectErr(
      await CrmScheduledPostRepository.findById(post.id, workspace.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should find only due SCHEDULED, non-deleted posts', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const now = new Date()
    const past = new Date(now.getTime() - 60_000)
    const future = new Date(now.getTime() + 60_000)
    const base = { workspaceId: workspace.id, createdById: user.id }
    const due = expectOk(
      await CrmScheduledPostRepository.create({
        ...base,
        status: 'SCHEDULED',
        scheduledFor: past,
      }),
    )
    await CrmScheduledPostRepository.create({
      ...base,
      status: 'SCHEDULED',
      scheduledFor: future,
    })
    await CrmScheduledPostRepository.create({
      ...base,
      status: 'DRAFT',
      scheduledFor: past,
    })
    const deleted = expectOk(
      await CrmScheduledPostRepository.create({
        ...base,
        status: 'SCHEDULED',
        scheduledFor: past,
      }),
    )
    await CrmScheduledPostRepository.softDelete(deleted.id)

    const list = expectOk(await CrmScheduledPostRepository.findDue(now))
    expect(list.map((p) => p.id)).toEqual([due.id])
  })

  it('should claim a SCHEDULED post only once', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const post = await seedCrmScheduledPost(workspace.id, user.id, {
      status: 'SCHEDULED',
    })

    expect(expectOk(await CrmScheduledPostRepository.claim(post.id))).toBe(true)
    expect(expectOk(await CrmScheduledPostRepository.claim(post.id))).toBe(
      false,
    )
    const stored = await prisma.crmScheduledPost.findUniqueOrThrow({
      where: { id: post.id },
    })
    expect(stored.status).toBe('PUBLISHING')
  })

  it('should update, set status, cancel and reschedule', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const post = await seedCrmScheduledPost(workspace.id, user.id)

    const updated = expectOk(
      await CrmScheduledPostRepository.update(post.id, {
        content: 'Novo',
        title: 'Título',
      }),
    )
    expect(updated.content).toBe('Novo')
    expect(updated.title).toBe('Título')

    const failed = expectOk(
      await CrmScheduledPostRepository.setStatus(post.id, 'FAILED', {
        publishedAt: null,
        lastError: 'oops',
      }),
    )
    expect(failed.status).toBe('FAILED')
    expect(failed.lastError).toBe('oops')

    expect(
      expectOk(await CrmScheduledPostRepository.setStatus(post.id, 'DRAFT'))
        .status,
    ).toBe('DRAFT')

    expect(
      expectOk(await CrmScheduledPostRepository.cancel(post.id)).status,
    ).toBe('CANCELED')

    const when = new Date(Date.now() + 86_400_000)
    const rescheduled = expectOk(
      await CrmScheduledPostRepository.reschedule(post.id, when),
    )
    expect(rescheduled.status).toBe('SCHEDULED')
    expect(rescheduled.scheduledFor?.getTime()).toBe(when.getTime())
  })

  it('should return DATABASE_ERROR when mutating an unknown post', async () => {
    const user = await seedUser()
    expectErr(
      await CrmScheduledPostRepository.create({
        workspaceId: 'missing',
        createdById: user.id,
        status: 'DRAFT',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.update('missing', { content: 'x' }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.setStatus('missing', 'FAILED'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.cancel('missing'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.reschedule('missing', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.softDelete('missing'),
      'DATABASE_ERROR',
    )
  })

  it('should return DATABASE_ERROR when read queries throw', async () => {
    vi.spyOn(prisma.crmScheduledPost, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma.crmScheduledPost, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.crmScheduledPost, 'updateMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await CrmScheduledPostRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.findDue(new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostRepository.findById('x', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(await CrmScheduledPostRepository.claim('x'), 'DATABASE_ERROR')
  })
})

describe('CrmScheduledPostTargetRepository', () => {
  it('should create targets per platform, list and update their status', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const post = await seedCrmScheduledPost(workspace.id, user.id)

    expect(
      expectOk(
        await CrmScheduledPostTargetRepository.createMany(post.id, [
          'INSTAGRAM',
          'FACEBOOK',
        ]),
      ),
    ).toBe(2)
    const targets = expectOk(
      await CrmScheduledPostTargetRepository.listByPost(post.id),
    )
    expect(targets.map((t) => t.platform).sort()).toEqual([
      'FACEBOOK',
      'INSTAGRAM',
    ])

    const published = expectOk(
      await CrmScheduledPostTargetRepository.setStatus(
        targets[0].id,
        'PUBLISHED',
        { externalPostId: 'ext-1', attempts: 1, publishedAt: new Date() },
      ),
    )
    expect(published.status).toBe('PUBLISHED')
    expect(published.externalPostId).toBe('ext-1')
    expect(
      expectOk(
        await CrmScheduledPostTargetRepository.setStatus(
          targets[1].id,
          'CANCELED',
        ),
      ).status,
    ).toBe('CANCELED')
  })

  it('should return DATABASE_ERROR on an unknown post or target', async () => {
    expectErr(
      await CrmScheduledPostTargetRepository.createMany('missing', ['TIKTOK']),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmScheduledPostTargetRepository.setStatus('missing', 'FAILED'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmScheduledPostTarget, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await CrmScheduledPostTargetRepository.listByPost('x'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmScheduledPostMediaRepository', () => {
  it('should short-circuit an empty seed list', async () => {
    expect(
      expectOk(await CrmScheduledPostMediaRepository.createMany('any', [])),
    ).toBe(0)
  })

  it('should persist media and list it by order', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const post = await seedCrmScheduledPost(workspace.id, user.id)

    expect(
      expectOk(
        await CrmScheduledPostMediaRepository.createMany(post.id, [
          {
            kind: 'VIDEO',
            storageKey: 'b.mp4',
            contentType: 'video/mp4',
            sizeBytes: 20,
            order: 1,
          },
          {
            kind: 'IMAGE',
            storageKey: 'a.png',
            contentType: 'image/png',
            sizeBytes: 10,
            order: 0,
          },
        ]),
      ),
    ).toBe(2)

    const media = expectOk(
      await CrmScheduledPostMediaRepository.listByPost(post.id),
    )
    expect(media.map((m) => m.storageKey)).toEqual(['a.png', 'b.mp4'])
  })

  it('should return DATABASE_ERROR on an unknown post or failed read', async () => {
    expectErr(
      await CrmScheduledPostMediaRepository.createMany('missing', [
        {
          kind: 'IMAGE',
          storageKey: 'a.png',
          contentType: 'image/png',
          sizeBytes: 1,
          order: 0,
        },
      ]),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmScheduledPostMedia, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await CrmScheduledPostMediaRepository.listByPost('x'),
      'DATABASE_ERROR',
    )
  })
})
