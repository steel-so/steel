import { describe, expect, it } from 'vitest'
import {
  createFakeApiTokenWithUser,
  createFakeApiTokenWithWorkspace,
} from '@/src/__tests__/factories/api-token.factory'
import { toApiTokenDTO, toWorkspaceApiTokenDTO } from '../api-token.mapper'

const NOW = new Date('2026-10-17T12:00:00Z')

describe('toApiTokenDTO', () => {
  it('maps the holder view without the hash', () => {
    const token = createFakeApiTokenWithWorkspace({
      id: 'tok-1',
      name: 'CI',
      prefix: 'abcd1234',
      scopes: ['api:write', 'api:read', 'offline_access'],
      modules: ['SERVICE_DESK', 'CRM'],
      createdVia: 'DEVICE',
      deviceName: 'notebook',
      expiresAt: new Date('2027-01-15T12:00:00Z'),
      lastUsedAt: new Date('2026-10-16T09:00:00Z'),
      createdAt: new Date('2026-10-01T09:00:00Z'),
    })
    const dto = toApiTokenDTO(token, NOW)
    expect(dto).toEqual({
      id: 'tok-1',
      name: 'CI',
      prefix: 'stl_pat_abcd1234',
      workspace: { id: token.workspaceId, name: 'Acme', slug: 'acme' },
      scopes: ['api:read', 'api:write'],
      modules: ['SERVICE_DESK', 'CRM'],
      createdVia: 'DEVICE',
      deviceName: 'notebook',
      expiresAt: '2027-01-15T12:00:00.000Z',
      expired: false,
      lastUsedAt: '2026-10-16T09:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
    })
    expect(dto).not.toHaveProperty('tokenHash')
  })

  it('flags an expired token and a never used one', () => {
    const dto = toApiTokenDTO(
      createFakeApiTokenWithWorkspace({ expiresAt: NOW, lastUsedAt: null }),
      NOW,
    )
    expect(dto.expired).toBe(true)
    expect(dto.lastUsedAt).toBeNull()
  })

  it('defaults `now` to the current time', () => {
    const dto = toApiTokenDTO(
      createFakeApiTokenWithWorkspace({ expiresAt: new Date(Date.now() - 1) }),
    )
    expect(dto.expired).toBe(true)
  })
})

describe('toWorkspaceApiTokenDTO', () => {
  it('maps the admin view with the holder', () => {
    const token = createFakeApiTokenWithUser({
      user: { name: 'Bia', email: 'bia@example.com', image: 'https://img' },
    })
    const dto = toWorkspaceApiTokenDTO(token, NOW)
    expect(dto.user).toEqual({
      id: token.userId,
      name: 'Bia',
      email: 'bia@example.com',
      image: 'https://img',
    })
    expect(dto).not.toHaveProperty('workspace')
    expect(dto.expired).toBe(false)
  })

  it('defaults `now` to the current time', () => {
    expect(toWorkspaceApiTokenDTO(createFakeApiTokenWithUser()).expired).toBe(
      false,
    )
  })
})
