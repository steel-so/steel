import { describe, expect, it } from 'vitest'
import {
  createFakeSdRemoteEndpoint,
  createFakeSdRemoteSession,
  createFakeSdRemoteSettings,
} from '@/src/__tests__/factories/nov-sd-remote.factory'
import {
  SD_REMOTE_DEFAULT_SETTINGS,
  toSdRemoteEndpointDTO,
  toSdRemoteSessionDTO,
  toSdRemoteSettingsDTO,
} from '../sd-remote.mapper'

describe('sd-remote mapper', () => {
  it('falls back to the defaults (off, RustDesk) without a row', () => {
    expect(toSdRemoteSettingsDTO(null)).toEqual(SD_REMOTE_DEFAULT_SETTINGS)
    expect(SD_REMOTE_DEFAULT_SETTINGS.enabled).toBe(false)
  })

  it('maps saved settings', () => {
    expect(
      toSdRemoteSettingsDTO(
        createFakeSdRemoteSettings({
          provider: 'ANYDESK',
          linkTemplate: 'anydesk:{id}',
        }),
      ),
    ).toEqual({
      enabled: true,
      provider: 'ANYDESK',
      linkTemplate: 'anydesk:{id}',
    })
  })

  it('maps endpoints and never exposes workspace ids', () => {
    const dto = toSdRemoteEndpointDTO(
      createFakeSdRemoteEndpoint({ source: 'INVENTORY' }),
    )
    expect(dto.source).toBe('INVENTORY')
    expect(dto).not.toHaveProperty('workspaceId')
    expect(
      toSdRemoteEndpointDTO(createFakeSdRemoteEndpoint({ source: 'x' })).source,
    ).toBe('MANUAL')
  })

  it('maps sessions with the user', () => {
    const dto = toSdRemoteSessionDTO(
      createFakeSdRemoteSession({ ticketId: 't1' }),
    )
    expect(dto).toMatchObject({
      ticketId: 't1',
      user: { id: 'u1', name: 'Ana Técnica' },
      startedAt: '2026-10-01T12:00:00.000Z',
    })
  })
})
