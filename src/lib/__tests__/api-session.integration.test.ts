import { describe, expect, it } from 'vitest'
import { seedApiToken } from '@/src/__tests__/factories/api-token.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { resolveApiSession } from '@/src/lib/api/session'
import { prisma } from '@/src/lib/prisma'
import { ApiTokenService } from '@/src/services/api-token.service'

/**
 * `resolveApiSession` against a real database (ADR 0035): what a token
 * resolves to, and every way it stops working on the next call.
 */

async function scenario() {
  const [user, workspace] = await Promise.all([seedUser(), seedWorkspace()])
  await seedMembership({
    userId: user.id,
    workspaceId: workspace.id,
    role: 'MEMBER',
  })
  await prisma.workspaceModuleAccess.createMany({
    data: (['SERVICE_DESK', 'CRM'] as const).map((module) => ({
      workspaceId: workspace.id,
      module,
      enabled: true,
      grantedById: user.id,
    })),
  })
  const { row, raw } = await seedApiToken({
    userId: user.id,
    workspaceId: workspace.id,
    scopes: ['api:read', 'api:write'],
    modules: ['CRM', 'COMMUNICATION'],
  })
  return { user, workspace, row, raw }
}

function bearer(raw: string) {
  return new Request('http://localhost/api/v1/me', {
    headers: { authorization: `Bearer ${raw}` },
  })
}

describe('resolveApiSession (integration)', () => {
  it('resolves a token and stamps lastUsedAt', async () => {
    const { user, workspace, row, raw } = await scenario()
    const session = expectOk(await resolveApiSession(bearer(raw)))
    expect(session).toEqual({
      tokenId: row.id,
      userId: user.id,
      workspaceId: workspace.id,
      scopes: ['api:read', 'api:write'],
      // COMMUNICATION is not enabled in the workspace.
      modules: ['CRM'],
      expiresAt: row.expiresAt,
    })
    expect(
      (await prisma.apiToken.findUnique({ where: { id: row.id } }))?.lastUsedAt,
    ).not.toBeNull()
  })

  it('stops working once revoked', async () => {
    const { user, row, raw } = await scenario()
    expectOk(await ApiTokenService.revokeForUser(user.id, row.id))
    expectErr(await resolveApiSession(bearer(raw)), 'UNAUTHORIZED')
  })

  it('stops working once expired', async () => {
    const { row, raw } = await scenario()
    await prisma.apiToken.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expectErr(await resolveApiSession(bearer(raw)), 'UNAUTHORIZED')
  })

  it('stops working when the holder leaves the workspace', async () => {
    const { user, workspace, raw } = await scenario()
    await prisma.membership.delete({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
      },
    })
    expectErr(await resolveApiSession(bearer(raw)), 'UNAUTHORIZED')
  })

  it('stops working when the workspace is suspended', async () => {
    const { workspace, raw } = await scenario()
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { status: 'SUSPENDED' },
    })
    expectErr(await resolveApiSession(bearer(raw)), 'UNAUTHORIZED')
  })

  it('rejects a tampered token', async () => {
    const { raw } = await scenario()
    const tampered = `${raw.slice(0, -1)}${raw.endsWith('A') ? 'B' : 'A'}`
    expectErr(await resolveApiSession(bearer(tampered)), 'UNAUTHORIZED')
  })
})
