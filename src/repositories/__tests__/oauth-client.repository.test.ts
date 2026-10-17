import { describe, expect, it, vi } from 'vitest'
import {
  seedIntegrationGrant,
  seedOauthAccessToken,
  seedOauthClient,
} from '@/src/__tests__/factories/integration-grant.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { hashOpaqueToken } from '@/src/lib/mcp/oauth-utils'
import { prisma } from '@/src/lib/prisma'
import { OauthClientRepository } from '../oauth-client.repository'

describe('OauthClientRepository', () => {
  it('finds a client summary by client id', async () => {
    const client = await seedOauthClient({ name: 'Cursor' })
    expect(
      expectOk(await OauthClientRepository.findByClientId(client.clientId)),
    ).toEqual({
      clientId: client.clientId,
      name: 'Cursor',
      icon: null,
      uri: null,
      disabled: false,
    })
    expect(
      expectOk(await OauthClientRepository.findByClientId('missing')),
    ).toBeNull()
  })

  it('finds an access token by its stored hash, with the client', async () => {
    const [user, workspace, client] = await Promise.all([
      seedUser(),
      seedWorkspace(),
      seedOauthClient(),
    ])
    const grant = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const { raw } = await seedOauthAccessToken({
      clientId: client.clientId,
      userId: user.id,
      referenceId: grant.id,
    })

    const token = expectOk(
      await OauthClientRepository.findAccessTokenByHash(
        hashOpaqueToken(raw.replace('stl_at_', '')),
      ),
    )
    expect(token?.referenceId).toBe(grant.id)
    expect(token?.client.clientId).toBe(client.clientId)
    expect(
      expectOk(await OauthClientRepository.findAccessTokenByHash('nope')),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when prisma throws', async () => {
    vi.spyOn(prisma.oauthClient, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.oauthAccessToken, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await OauthClientRepository.findByClientId('x'), 'DATABASE_ERROR')
    expectErr(
      await OauthClientRepository.findAccessTokenByHash('x'),
      'DATABASE_ERROR',
    )
  })
})
