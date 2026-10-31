import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCoexistenceConnection,
  createFakeMetaChannelSettings,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-meta-channel.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import { WhatsAppMetaChannelService } from '../whatsapp-meta-channel.service'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(WhatsAppMetaChannelRepository)

function asRole(role: 'MEMBER' | 'ADMIN') {
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('ADMIN')
})

describe('getSettings()', () => {
  it('returns everything off when nothing was saved', async () => {
    repo.findSettings.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppMetaChannelService.getSettings('u1', 'ws1')),
    ).toEqual({ workspaceId: 'ws1', coexistenceEnabled: false })
  })

  it('returns the saved switches', async () => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeMetaChannelSettings({ coexistenceEnabled: true })),
    )
    expect(
      expectOk(await WhatsAppMetaChannelService.getSettings('u1', 'ws1'))
        .coexistenceEnabled,
    ).toBe(true)
  })

  it('rejects a non-member', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppMetaChannelService.getSettings('u1', 'ws1'),
      'FORBIDDEN',
    )
  })

  it('propagates a database error', async () => {
    repo.findSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.getSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('updateSettings()', () => {
  it('saves the switches and audits the change', async () => {
    repo.upsertSettings.mockResolvedValue(
      ok(createFakeMetaChannelSettings({ coexistenceEnabled: true })),
    )
    const dto = expectOk(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        coexistenceEnabled: true,
      }),
    )
    expect(dto.coexistenceEnabled).toBe(true)
    expect(repo.upsertSettings).toHaveBeenCalledWith('ws1', {
      coexistenceEnabled: true,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_settings',
        action: 'update',
        meta: { scope: 'meta_channels', changed: ['coexistenceEnabled'] },
      }),
    )
  })

  it('forbids a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        coexistenceEnabled: true,
      }),
      'FORBIDDEN',
    )
    expect(repo.upsertSettings).not.toHaveBeenCalled()
  })

  it('propagates a database error', async () => {
    repo.upsertSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        coexistenceEnabled: true,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('listConnections()', () => {
  it('maps the connections', async () => {
    repo.listCoexistenceConnections.mockResolvedValue(
      ok([createFakeCoexistenceConnection({ id: 'c1' })]),
    )
    const list = expectOk(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
    )
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('c1')
  })

  it('rejects a non-member and propagates database errors', async () => {
    repo.listCoexistenceConnections.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
      'FORBIDDEN',
    )
  })
})
