import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppCloseStatus } from '@/src/__tests__/factories/whatsapp-close-status.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-close-status.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppCloseStatusService } from '../whatsapp-close-status.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedStatusRepo = vi.mocked(WhatsAppCloseStatusRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)

const won = createFakeWhatsAppCloseStatus({
  id: 's1',
  workspaceId: 'ws1',
  label: 'Venda realizada',
  outcome: 'SUCCESS',
  position: 0,
})
const lost = createFakeWhatsAppCloseStatus({
  id: 's2',
  workspaceId: 'ws1',
  label: 'Sem interesse',
  outcome: 'FAILURE',
  position: 1,
})

function asRole(role: 'MEMBER' | 'VIEWER' | 'ADMIN') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function withRules(min: number, max: number) {
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        closeStatusMinSelections: min,
        closeStatusMaxSelections: max,
      }),
    ),
  )
}

beforeEach(() => {
  mockedStatusRepo.listActive.mockResolvedValue(ok([won, lost]))
  withRules(0, 1)
})

describe('WhatsAppCloseStatusService.listOptions()', () => {
  it('should list the statuses with the selection rules for an agent', async () => {
    asRole('MEMBER')
    withRules(1, 2)

    const options = expectOk(
      await WhatsAppCloseStatusService.listOptions('u1', 'ws1'),
    )

    expect(options).toEqual({
      statuses: [
        { id: 's1', label: 'Venda realizada', outcome: 'SUCCESS', position: 0 },
        { id: 's2', label: 'Sem interesse', outcome: 'FAILURE', position: 1 },
      ],
      minSelections: 1,
      maxSelections: 2,
    })
  })
})

describe('WhatsAppCloseStatusService.create()', () => {
  it('should append the status after the last position and audit it', async () => {
    asRole('ADMIN')
    mockedStatusRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppCloseStatus({ id: 's3', position: 2 })),
    )

    expectOk(
      await WhatsAppCloseStatusService.create('u1', 'ws1', {
        label: 'Retornar depois',
        outcome: 'FAILURE',
      }),
    )

    expect(mockedStatusRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      label: 'Retornar depois',
      outcome: 'FAILURE',
      position: 2,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_close_status',
        action: 'create',
        targetId: 's3',
      }),
    )
  })

  it('should forbid a non-admin member', async () => {
    asRole('MEMBER')

    expectErr(
      await WhatsAppCloseStatusService.create('u1', 'ws1', {
        label: 'X',
        outcome: 'SUCCESS',
      }),
      'FORBIDDEN',
    )
  })

  it('should refuse past the per-workspace limit', async () => {
    asRole('ADMIN')
    mockedStatusRepo.listActive.mockResolvedValue(
      ok(
        Array.from({ length: 50 }, (_, position) =>
          createFakeWhatsAppCloseStatus({ position }),
        ),
      ),
    )

    expectErr(
      await WhatsAppCloseStatusService.create('u1', 'ws1', {
        label: 'X',
        outcome: 'SUCCESS',
      }),
      'WHATSAPP_CLOSE_STATUS_LIMIT_REACHED',
    )
  })
})

describe('WhatsAppCloseStatusService.update()/archive()', () => {
  it('should answer not found for a status of another workspace', async () => {
    asRole('ADMIN')
    mockedStatusRepo.findActiveById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppCloseStatusService.update('u1', 'ws1', 'sX', {
        label: 'Novo',
      }),
      'WHATSAPP_CLOSE_STATUS_NOT_FOUND',
    )
    expectErr(
      await WhatsAppCloseStatusService.archive('u1', 'ws1', 'sX'),
      'WHATSAPP_CLOSE_STATUS_NOT_FOUND',
    )
  })

  it('should archive instead of deleting', async () => {
    asRole('ADMIN')
    mockedStatusRepo.findActiveById.mockResolvedValue(ok(won))
    mockedStatusRepo.update.mockResolvedValue(ok(won))

    expect(
      expectOk(await WhatsAppCloseStatusService.archive('u1', 'ws1', 's1')),
    ).toEqual({ id: 's1' })
    expect(mockedStatusRepo.update).toHaveBeenCalledWith('s1', {
      archivedAt: expect.any(Date),
    })
  })
})

describe('WhatsAppCloseStatusService.resolveClassification()', () => {
  it('should return null when nothing is picked and nothing is required', async () => {
    expect(
      expectOk(
        await WhatsAppCloseStatusService.resolveClassification('ws1', []),
      ),
    ).toBeNull()
  })

  it('should resolve SUCCESS with the labels in display order', async () => {
    withRules(1, 2)

    expect(
      expectOk(
        await WhatsAppCloseStatusService.resolveClassification('ws1', ['s1']),
      ),
    ).toEqual({
      outcome: 'SUCCESS',
      statusIds: ['s1'],
      labels: ['Venda realizada'],
    })
  })

  it('should resolve FAILURE when any picked status is a failure', async () => {
    withRules(0, 2)

    expect(
      expectOk(
        await WhatsAppCloseStatusService.resolveClassification('ws1', [
          's2',
          's1',
        ]),
      ),
    ).toEqual({
      outcome: 'FAILURE',
      statusIds: ['s1', 's2'],
      labels: ['Venda realizada', 'Sem interesse'],
    })
  })

  it('should enforce the minimum and the maximum', async () => {
    withRules(1, 1)

    expectErr(
      await WhatsAppCloseStatusService.resolveClassification('ws1', []),
      'WHATSAPP_CLOSE_STATUS_SELECTION_INVALID',
    )
    expectErr(
      await WhatsAppCloseStatusService.resolveClassification('ws1', [
        's1',
        's2',
      ]),
      'WHATSAPP_CLOSE_STATUS_SELECTION_INVALID',
    )
  })

  it('should reject an unknown or archived status', async () => {
    expectErr(
      await WhatsAppCloseStatusService.resolveClassification('ws1', ['sX']),
      'WHATSAPP_CLOSE_STATUS_SELECTION_INVALID',
    )
  })

  it('should ignore the minimum when the workspace has no statuses', async () => {
    mockedStatusRepo.listActive.mockResolvedValue(ok([]))
    withRules(2, 3)

    expect(
      expectOk(
        await WhatsAppCloseStatusService.resolveClassification('ws1', []),
      ),
    ).toBeNull()
  })
})
