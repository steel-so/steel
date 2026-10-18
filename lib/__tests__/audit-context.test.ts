import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  currentAuditContext,
  runWithAuditContext,
} from '@/lib/axiom/audit-context'
import { logger } from '@/lib/axiom/logger'

beforeEach(() => vi.clearAllMocks())

describe('audit context (public API v1)', () => {
  it('stamps source and token on mutations audited inside the context', async () => {
    await runWithAuditContext({ source: 'api', apiTokenId: 'tok_1' }, async () => {
      await Promise.resolve()
      auditMutation({ entity: 'crm_lead', action: 'create', actorId: 'u1' })
    })

    expect(logger.info).toHaveBeenCalledWith(
      'audit.mutation.crm_lead.create',
      expect.objectContaining({ source: 'api', apiTokenId: 'tok_1', actorId: 'u1' }),
    )
    expect(currentAuditContext()).toBeUndefined()
  })

  it('adds nothing outside the context', () => {
    auditMutation({
      entity: 'crm_lead',
      action: 'create',
      actorId: 'u1',
      outcome: 'failure',
    })
    const fields = vi.mocked(logger.warn).mock.calls[0][1] as Record<string, unknown>
    expect(fields).not.toHaveProperty('source')
    expect(fields).not.toHaveProperty('apiTokenId')
  })
})
