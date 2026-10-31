import { describe, expect, it } from 'vitest'
import {
  seedSdRemoteEndpoint,
  seedSdRemoteSettings,
} from '@/src/__tests__/factories/nov-sd-remote.factory'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { SdRemoteRepository } from '../sd-remote.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  const item = await seedSdConfigItem(workspace.id, user.id)
  return { workspace, other, user, item }
}

describe('settings', () => {
  it('is null until saved, then upserts in place', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(await SdRemoteRepository.findSettings(workspace.id)),
    ).toBeNull()

    const first = expectOk(
      await SdRemoteRepository.upsertSettings(workspace.id, { enabled: true }),
    )
    expect(first).toMatchObject({ enabled: true, provider: 'RUSTDESK' })

    const second = expectOk(
      await SdRemoteRepository.upsertSettings(workspace.id, {
        provider: 'ANYDESK',
        linkTemplate: 'anydesk:{id}',
      }),
    )
    expect(second).toMatchObject({
      enabled: true,
      provider: 'ANYDESK',
      linkTemplate: 'anydesk:{id}',
    })
  })
})

describe('endpoints', () => {
  it('keeps one id per asset and provider (upsert) and scopes by workspace', async () => {
    const { workspace, other, item } = await setup()
    await seedSdRemoteSettings(workspace.id)

    const created = expectOk(
      await SdRemoteRepository.upsertEndpoint({
        workspaceId: workspace.id,
        configItemId: item.id,
        provider: 'RUSTDESK',
        remoteId: '111111111',
        source: 'INVENTORY',
      }),
    )
    const replaced = expectOk(
      await SdRemoteRepository.upsertEndpoint({
        workspaceId: workspace.id,
        configItemId: item.id,
        provider: 'RUSTDESK',
        remoteId: '222222222',
        source: 'MANUAL',
      }),
    )
    expect(replaced.id).toBe(created.id)
    expect(replaced).toMatchObject({ remoteId: '222222222', source: 'MANUAL' })

    await seedSdRemoteEndpoint({
      workspaceId: workspace.id,
      configItemId: item.id,
      provider: 'ANYDESK',
      remoteId: '333333333',
    })
    const list = expectOk(
      await SdRemoteRepository.listEndpoints(workspace.id, item.id),
    )
    expect(list.map((e) => e.provider)).toEqual(['RUSTDESK', 'ANYDESK'])
    expect(
      expectOk(await SdRemoteRepository.listEndpoints(other.id, item.id)),
    ).toEqual([])

    expect(
      expectOk(
        await SdRemoteRepository.findEndpoint(workspace.id, item.id, 'ANYDESK'),
      ).remoteId,
    ).toBe('333333333')
    expectErr(
      await SdRemoteRepository.findEndpoint(other.id, item.id, 'ANYDESK'),
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
    )
    expectErr(
      await SdRemoteRepository.findEndpointById(other.id, created.id),
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
    )
    expect(
      expectOk(
        await SdRemoteRepository.findEndpointById(workspace.id, created.id),
      ).id,
    ).toBe(created.id)
  })

  it('deletes an endpoint, and a second delete is a not-found', async () => {
    const { workspace, item } = await setup()
    const endpoint = await seedSdRemoteEndpoint({
      workspaceId: workspace.id,
      configItemId: item.id,
    })
    expectOk(await SdRemoteRepository.deleteEndpoint(endpoint.id))
    expectErr(
      await SdRemoteRepository.deleteEndpoint(endpoint.id),
      'SD_CONFIG_NOT_FOUND',
    )
  })
})

describe('sessions', () => {
  it('records sessions and lists the newest first within the workspace', async () => {
    const { workspace, other, user, item } = await setup()
    const base = {
      workspaceId: workspace.id,
      configItemId: item.id,
      ticketId: null,
      userId: user.id,
      provider: 'RUSTDESK' as const,
      remoteId: '123456789',
    }
    const first = expectOk(await SdRemoteRepository.createSession(base))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = expectOk(await SdRemoteRepository.createSession(base))
    expect(second.user).toEqual({ id: user.id, name: user.name })

    const list = expectOk(
      await SdRemoteRepository.listSessions(workspace.id, item.id, 10),
    )
    expect(list.map((s) => s.id)).toEqual([second.id, first.id])
    expect(
      expectOk(await SdRemoteRepository.listSessions(workspace.id, item.id, 1)),
    ).toHaveLength(1)
    expect(
      expectOk(await SdRemoteRepository.listSessions(other.id, item.id, 10)),
    ).toEqual([])
  })
})
