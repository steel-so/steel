import { describe, expect, it, vi } from 'vitest'
import { seedApiToken } from '@/src/__tests__/factories/api-token.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { generateApiToken } from '@/src/lib/api/token'
import { prisma } from '@/src/lib/prisma'
import { ApiTokenRepository } from '../api-token.repository'

const DAY_MS = 24 * 60 * 60 * 1000

async function scenario() {
  const [user, workspace] = await Promise.all([seedUser(), seedWorkspace()])
  return { user, workspace }
}

describe('ApiTokenRepository', () => {
  it('creates a token with its workspace and finds it by id and hash', async () => {
    const { user, workspace } = await scenario()
    const generated = generateApiToken()
    const created = expectOk(
      await ApiTokenRepository.create({
        userId: user.id,
        workspaceId: workspace.id,
        name: 'CI',
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresAt: new Date(Date.now() + DAY_MS),
        createdVia: 'DEVICE',
        deviceName: 'notebook',
      }),
    )
    expect(created.workspace).toEqual({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    })
    expect(created.createdVia).toBe('DEVICE')

    expect(expectOk(await ApiTokenRepository.findById(created.id)).name).toBe(
      'CI',
    )
    expect(
      expectOk(await ApiTokenRepository.findByHash(generated.tokenHash))?.id,
    ).toBe(created.id)
    expect(expectOk(await ApiTokenRepository.findByHash('nope'))).toBeNull()
  })

  it('rejects a duplicate hash', async () => {
    const { user, workspace } = await scenario()
    const { row } = await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
    })
    expectErr(
      await ApiTokenRepository.create({
        userId: user.id,
        workspaceId: workspace.id,
        name: 'dup',
        tokenHash: row.tokenHash,
        prefix: row.prefix,
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresAt: row.expiresAt,
        createdVia: 'SETTINGS',
      }),
      'DATABASE_ERROR',
    )
  })

  it('returns RESOURCE_NOT_FOUND for a missing token', async () => {
    expectErr(
      await ApiTokenRepository.findById('missing'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('lists non-revoked tokens per user and per workspace, newest first', async () => {
    const { user, workspace } = await scenario()
    const other = await seedUser()
    const older = await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
      name: 'older',
      expiresAt: new Date(Date.now() - DAY_MS),
    })
    const newer = await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
      name: 'newer',
    })
    await prisma.apiToken.update({
      where: { id: older.row.id },
      data: { createdAt: new Date(Date.now() - DAY_MS) },
    })
    await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
      revokedAt: new Date(),
    })
    const theirs = await seedApiToken({
      userId: other.id,
      workspaceId: workspace.id,
    })

    const mine = expectOk(await ApiTokenRepository.listByUser(user.id))
    expect(mine.map((t) => t.id)).toEqual([newer.row.id, older.row.id])
    expect(mine[0].workspace.slug).toBe(workspace.slug)

    const all = expectOk(await ApiTokenRepository.listByWorkspace(workspace.id))
    expect(all.map((t) => t.id).sort()).toEqual(
      [newer.row.id, older.row.id, theirs.row.id].sort(),
    )
    expect(all.find((t) => t.id === theirs.row.id)?.user.email).toBe(
      other.email,
    )
  })

  it('counts only working tokens', async () => {
    const { user, workspace } = await scenario()
    await seedApiToken({ userId: user.id, workspaceId: workspace.id })
    await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
      expiresAt: new Date(Date.now() - 1000),
    })
    await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
      revokedAt: new Date(),
    })
    expect(
      expectOk(await ApiTokenRepository.countActiveByUser(user.id, new Date())),
    ).toBe(1)
  })

  it('revokes once', async () => {
    const { user, workspace } = await scenario()
    const { row } = await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
    })
    const at = new Date()
    expect(expectOk(await ApiTokenRepository.revoke(row.id, at))).toBe(true)
    expect(expectOk(await ApiTokenRepository.revoke(row.id, at))).toBe(false)
    expect(
      (await prisma.apiToken.findUnique({ where: { id: row.id } }))?.revokedAt,
    ).toEqual(at)
  })

  it('stamps lastUsedAt at most once per throttle window', async () => {
    const { user, workspace } = await scenario()
    const { row } = await seedApiToken({
      userId: user.id,
      workspaceId: workspace.id,
    })
    const t0 = new Date()
    expect(
      expectOk(await ApiTokenRepository.touchLastUsed(row.id, t0, 60_000)),
    ).toBe(true)
    expect(
      expectOk(
        await ApiTokenRepository.touchLastUsed(
          row.id,
          new Date(t0.getTime() + 30_000),
          60_000,
        ),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await ApiTokenRepository.touchLastUsed(
          row.id,
          new Date(t0.getTime() + 61_000),
          60_000,
        ),
      ),
    ).toBe(true)
  })

  it('wraps database failures', async () => {
    const failing = vi
      .spyOn(prisma.apiToken, 'findUnique')
      .mockRejectedValue(new Error('boom'))
    expectErr(await ApiTokenRepository.findById('x'), 'DATABASE_ERROR')
    expectErr(await ApiTokenRepository.findByHash('x'), 'DATABASE_ERROR')
    failing.mockRestore()

    vi.spyOn(prisma.apiToken, 'findMany').mockRejectedValue(new Error('boom'))
    expectErr(await ApiTokenRepository.listByUser('x'), 'DATABASE_ERROR')
    expectErr(await ApiTokenRepository.listByWorkspace('x'), 'DATABASE_ERROR')

    vi.spyOn(prisma.apiToken, 'count').mockRejectedValue(new Error('boom'))
    expectErr(
      await ApiTokenRepository.countActiveByUser('x', new Date()),
      'DATABASE_ERROR',
    )

    vi.spyOn(prisma.apiToken, 'updateMany').mockRejectedValue(new Error('boom'))
    expectErr(
      await ApiTokenRepository.revoke('x', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await ApiTokenRepository.touchLastUsed('x', new Date(), 1),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})
