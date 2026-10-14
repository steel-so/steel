import type { SdSettings } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-config.repository')
vi.mock('@/src/repositories/sd-settings.repository')
vi.mock('@/src/repositories/sd-sla-policy.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { SdConfigRepository } from '@/src/repositories/sd-config.repository'
import { SdSettingsRepository } from '@/src/repositories/sd-settings.repository'
import { SdSlaPolicyRepository } from '@/src/repositories/sd-sla-policy.repository'
import { SdSettingsService } from '../sd-settings.service'

const repo = vi.mocked(SdSettingsRepository)
const slaRepo = vi.mocked(SdSlaPolicyRepository)
const refs = vi.mocked(SdConfigRepository.findExistingRefs)

function settingsRow(overrides: Partial<SdSettings> = {}): SdSettings {
  const now = new Date('2026-01-01T00:00:00Z')
  return {
    id: 's1',
    workspaceId: 'ws1',
    nextTicketNumber: 1,
    ticketPrefixes: { INCIDENT: 'INC' },
    defaultDepartmentId: null,
    defaultSlaPolicyId: null,
    whatsappConnectionId: null,
    whatsappSendAcknowledgement: true,
    portalEnabled: true,
    portalTicketTypes: ['INCIDENT', 'SERVICE_REQUEST'],
    portalCompanyScope: true,
    requireSignatureOnClose: false,
    requireSolutionOnResolve: true,
    autoCloseResolvedAfterHours: 72,
    slaAtRiskPercent: 80,
    reopenOnRequesterReply: true,
    autoAssignRoundRobin: false,
    kbReviewIntervalDays: 180,
    aiEnabled: false,
    aiPreServiceEnabled: false,
    aiAutoTriageEnabled: false,
    aiWhatsappAutoReply: false,
    aiPersona: null,
    aiInstructions: null,
    aiHandoffKeywords: [],
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  actAs('owner')
  refs.mockImplementation(async (_ws, wanted) => ok(wanted))
  repo.getOrCreate.mockResolvedValue(ok(settingsRow()))
  repo.update.mockResolvedValue(ok(settingsRow({ portalEnabled: false })))
  repo.whatsappConnectionExists.mockResolvedValue(ok(true))
  slaRepo.setDefault.mockResolvedValue(ok(undefined))
})

describe('SdSettingsService.get', () => {
  it.each(['requester', 'agent', 'viewer'] as const)(
    'lets a %s read (row created lazily)',
    async (actor) => {
      actAs(actor)
      const dto = expectOk(await SdSettingsService.get('u1', 'ws1'))
      expect(dto.ticketPrefixes).toEqual({
        INCIDENT: 'INC',
        SERVICE_REQUEST: 'REQ',
        CHANGE: 'CHG',
        PROBLEM: 'PRB',
      })
      expect(repo.getOrCreate).toHaveBeenCalledWith('ws1')
    },
  )

  it('refuses strangers and disabled modules', async () => {
    actAs('stranger')
    expectErr(await SdSettingsService.get('u1', 'ws1'), 'FORBIDDEN')
    actAs('disabled')
    expectErr(await SdSettingsService.get('u1', 'ws1'), 'MODULE_DISABLED')
  })

  it('propagates database errors', async () => {
    repo.getOrCreate.mockResolvedValue(err(databaseError()))
    expectErr(await SdSettingsService.get('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('SdSettingsService.update', () => {
  it('merges prefixes, stamps the actor and audits', async () => {
    const dto = expectOk(
      await SdSettingsService.update('u1', 'ws1', {
        ticketPrefixes: { CHANGE: 'MUD' },
        portalEnabled: false,
      }),
    )
    expect(dto.portalEnabled).toBe(false)
    expect(repo.update).toHaveBeenCalledWith('ws1', {
      portalEnabled: false,
      ticketPrefixes: {
        INCIDENT: 'INC',
        SERVICE_REQUEST: 'REQ',
        CHANGE: 'MUD',
        PROBLEM: 'PRB',
      },
      updatedById: 'u1',
    })
    expect(slaRepo.setDefault).not.toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_settings',
        action: 'update',
        targetId: 'ws1',
      }),
    )
  })

  it('syncs the default SLA policy and validates referenced ids', async () => {
    expectOk(
      await SdSettingsService.update('u1', 'ws1', {
        defaultSlaPolicyId: 'p1',
        defaultDepartmentId: 'd1',
      }),
    )
    expect(refs).toHaveBeenCalledWith('ws1', {
      departmentIds: ['d1'],
      slaPolicyIds: ['p1'],
    })
    expect(slaRepo.setDefault).toHaveBeenCalledWith('ws1', 'p1')
  })

  it('fails when the SLA sync fails', async () => {
    slaRepo.setDefault.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSettingsService.update('u1', 'ws1', { defaultSlaPolicyId: 'p1' }),
      'DATABASE_ERROR',
    )
  })

  it('rejects ids from another workspace', async () => {
    refs.mockResolvedValue(ok({}))
    const error = expectErr(
      await SdSettingsService.update('u1', 'ws1', {
        defaultDepartmentId: 'foreign',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    expect(error.details).toEqual({
      missing: [{ kind: 'departmentIds', id: 'foreign' }],
    })
    expect(repo.update).not.toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('checks the WhatsApp connection belongs to the ServiceDesk', async () => {
    repo.whatsappConnectionExists.mockResolvedValue(ok(false))
    const error = expectErr(
      await SdSettingsService.update('u1', 'ws1', {
        whatsappConnectionId: 'c1',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    expect(error.message).toMatch(/WhatsApp/)
    repo.whatsappConnectionExists.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSettingsService.update('u1', 'ws1', {
        whatsappConnectionId: 'c1',
      }),
      'DATABASE_ERROR',
    )
    repo.whatsappConnectionExists.mockResolvedValue(ok(true))
    expectOk(
      await SdSettingsService.update('u1', 'ws1', {
        whatsappConnectionId: 'c1',
      }),
    )
  })

  it('propagates load and update errors', async () => {
    repo.getOrCreate.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSettingsService.update('u1', 'ws1', { aiEnabled: true }),
      'DATABASE_ERROR',
    )
    repo.getOrCreate.mockResolvedValue(ok(settingsRow()))
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSettingsService.update('u1', 'ws1', { aiEnabled: true }),
      'DATABASE_ERROR',
    )
  })

  it.each([
    ['requester', 'FORBIDDEN'],
    ['agent', 'FORBIDDEN'],
    ['viewer', 'FORBIDDEN'],
    ['stranger', 'FORBIDDEN'],
    ['disabled', 'MODULE_DISABLED'],
  ] as const)('refuses %s', async (actor, code) => {
    actAs(actor)
    expectErr(
      await SdSettingsService.update('u1', 'ws1', { aiEnabled: true }),
      code,
    )
    expect(repo.update).not.toHaveBeenCalled()
  })
})
