import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventoryToken } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdInventoryTokenNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-inventory-token.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import {
  hashSdInventoryToken,
  newSdInventoryToken,
  SdInventoryTokenService,
} from '../sd-inventory-token.service'

const tokens = vi.mocked(SdInventoryTokenRepository)
const WS = 'ws1'

beforeEach(() => {
  actAs('owner')
  tokens.list.mockResolvedValue(ok([createFakeSdInventoryToken()]))
  tokens.create.mockResolvedValue(ok(createFakeSdInventoryToken()))
  tokens.findById.mockResolvedValue(ok(createFakeSdInventoryToken()))
  tokens.revoke.mockResolvedValue(ok(undefined))
})

describe('token helpers', () => {
  it('hashes with sha-256, in base64url, never repeating', () => {
    const a = newSdInventoryToken()
    const b = newSdInventoryToken()
    expect(a.token).not.toBe(b.token)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).toBe(hashSdInventoryToken(a.token))
  })
})

describe('SdInventoryTokenService.list', () => {
  it('lists for admins without leaking the hash', async () => {
    const list = expectOk(await SdInventoryTokenService.list('u1', WS))
    expect(list[0]).not.toHaveProperty('tokenHash')
    expect(tokens.list).toHaveBeenCalledWith(WS)
  })

  it.each(['agent', 'requester', 'viewer', 'stranger'] as const)(
    'refuses %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdInventoryTokenService.list('u1', WS))
      expect(tokens.list).not.toHaveBeenCalled()
    },
  )

  it('propagates database errors', async () => {
    tokens.list.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryTokenService.list('u1', WS), 'DATABASE_ERROR')
  })
})

describe('SdInventoryTokenService.create', () => {
  it('stores only the hash and returns the plain token once', async () => {
    const created = expectOk(
      await SdInventoryTokenService.create('u1', WS, { name: 'Matriz' }),
    )
    const stored = tokens.create.mock.calls[0]?.[0]
    expect(stored).toMatchObject({
      workspaceId: WS,
      name: 'Matriz',
      createdById: 'u1',
    })
    expect(stored?.tokenHash).toBe(hashSdInventoryToken(created.token))
    expect(stored?.tokenHash).not.toBe(created.token)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_inventory_token',
        action: 'create',
      }),
    )
  })

  it.each(['agent', 'requester', 'viewer', 'stranger', 'disabled'] as const)(
    'denies %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdInventoryTokenService.create('u1', WS, { name: 'x' }))
      expect(tokens.create).not.toHaveBeenCalled()
    },
  )

  it('audits the failure when the repository fails', async () => {
    tokens.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryTokenService.create('u1', WS, { name: 'x' }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
  })
})

describe('SdInventoryTokenService.revoke', () => {
  it('revokes an existing token of the workspace', async () => {
    expectOk(await SdInventoryTokenService.revoke('u1', WS, 'tok-1'))
    expect(tokens.findById).toHaveBeenCalledWith('tok-1', WS)
    expect(tokens.revoke).toHaveBeenCalledWith('tok-1', WS)
  })

  it('does not touch a token of another workspace', async () => {
    tokens.findById.mockResolvedValue(err(sdInventoryTokenNotFound()))
    expectErr(
      await SdInventoryTokenService.revoke('u1', WS, 'tok-x'),
      'SD_INVENTORY_TOKEN_NOT_FOUND',
    )
    expect(tokens.revoke).not.toHaveBeenCalled()
  })

  it('denies non-admins', async () => {
    actAs('agent')
    expectErr(await SdInventoryTokenService.revoke('u1', WS, 'tok-1'))
    expect(tokens.revoke).not.toHaveBeenCalled()
  })
})
