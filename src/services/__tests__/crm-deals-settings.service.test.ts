import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeCrmDealsSettings } from '@/src/__tests__/factories/nov-crm-deals.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-deals-settings.repository')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmDealsSettingsRepository } from '@/src/repositories/crm-deals-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmDealsSettingsService } from '../crm-deals-settings.service'

const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)
const repo = vi.mocked(CrmDealsSettingsRepository)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

beforeEach(() => {
  vi.resetAllMocks()
  access.isEnabled.mockResolvedValue(ok(true))
  asRole('OWNER')
})

describe('CrmDealsSettingsService.get', () => {
  it('returns the defaults, payment off, when nothing is saved', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(null))
    const dto = expectOk(await CrmDealsSettingsService.get('u', 'ws'))
    expect(dto.proposalPaymentEnabled).toBe(false)
    expect(dto.renewalLeadDays).toBe(60)
  })

  it('refuses a non-member and a disabled module', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmDealsSettingsService.get('u', 'ws'), 'FORBIDDEN')
    asRole('MEMBER')
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(await CrmDealsSettingsService.get('u', 'ws'), 'MODULE_DISABLED')
  })

  it('propagates a database error', async () => {
    repo.findByWorkspace.mockResolvedValue(err(databaseError('boom')))
    expectErr(await CrmDealsSettingsService.get('u', 'ws'), 'DATABASE_ERROR')
  })
})

describe('CrmDealsSettingsService.update', () => {
  it('saves and audits for an owner', async () => {
    repo.upsert.mockResolvedValue(
      ok(createFakeCrmDealsSettings({ proposalPaymentEnabled: true })),
    )
    const dto = expectOk(
      await CrmDealsSettingsService.update('u', 'ws', {
        proposalPaymentEnabled: true,
      }),
    )
    expect(dto.proposalPaymentEnabled).toBe(true)
    expect(repo.upsert).toHaveBeenCalledWith('ws', 'u', {
      proposalPaymentEnabled: true,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_deals_settings', action: 'update' }),
    )
  })

  it('refuses a plain member', async () => {
    asRole('MEMBER')
    expectErr(
      await CrmDealsSettingsService.update('u', 'ws', {}),
      'FORBIDDEN',
    )
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('propagates a database error without auditing', async () => {
    repo.upsert.mockResolvedValue(err(databaseError('boom')))
    expectErr(
      await CrmDealsSettingsService.update('u', 'ws', {}),
      'DATABASE_ERROR',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('CrmDealsSettingsService.resolve', () => {
  it('skips the access check', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(createFakeCrmDealsSettings({ renewalLeadDays: 90 })),
    )
    expect(
      expectOk(await CrmDealsSettingsService.resolve('ws')).renewalLeadDays,
    ).toBe(90)
    expect(members.findByUserAndWorkspace).not.toHaveBeenCalled()
  })
})
