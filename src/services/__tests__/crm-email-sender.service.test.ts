import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSendingDomain } from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sending-domain.repository', () => ({
  SendingDomainRepository: { listByWorkspace: vi.fn() },
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmEmailSenderService } from '../crm-email-sender.service'

const membership = vi.mocked(MembershipRepository)
const domains = vi.mocked(SendingDomainRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

function member(role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: 'u1', workspaceId: 'ws1' })),
  )
}

beforeEach(() => {
  member()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  domains.listByWorkspace.mockResolvedValue(
    ok([
      createFakeSendingDomain({ name: 'news.zeta.com.br', status: 'VERIFIED' }),
      createFakeSendingDomain({ name: 'pending.acme.com', status: 'PENDING' }),
      createFakeSendingDomain({ name: 'news.acme.com.br', status: 'VERIFIED' }),
      createFakeSendingDomain({ name: 'old.acme.com', status: 'FAILED' }),
    ]),
  )
})

describe('CrmEmailSenderService.options()', () => {
  it('lists only verified domain names, sorted, plus the platform address', async () => {
    const options = expectOk(await CrmEmailSenderService.options('u1', 'ws1'))
    expect(options).toEqual({
      platformAddress: 'notificacoes@stratustelecom.com.br',
      verifiedDomains: ['news.acme.com.br', 'news.zeta.com.br'],
    })
    expect(domains.listByWorkspace).toHaveBeenCalledWith('ws1')
  })

  it('is readable by a VIEWER of the CRM', async () => {
    member('VIEWER')
    expectOk(await CrmEmailSenderService.options('u1', 'ws1'))
  })

  it('refuses a non-member', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmEmailSenderService.options('u1', 'ws1'), 'FORBIDDEN')
    expect(domains.listByWorkspace).not.toHaveBeenCalledWith('ws-other')
  })

  it('refuses when the CRM module is disabled', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await CrmEmailSenderService.options('u1', 'ws1'),
      'MODULE_DISABLED',
    )
  })

  it('propagates a database error', async () => {
    domains.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailSenderService.options('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})
