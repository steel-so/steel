import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/whatsapp-contact.repository')

import { logger } from '@/lib/axiom/logger'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { checkWhatsAppOptOut } from '../whatsapp-opt-out'

const repo = vi.mocked(WhatsAppContactRepository)

describe('checkWhatsAppOptOut()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows a contact that never opted out', async () => {
    repo.findByWaId.mockResolvedValue(
      ok({ broadcastOptedOutAt: null } as never),
    )
    expect(await checkWhatsAppOptOut('ws', '5511999998888')).toBe('allowed')
    expect(repo.findByWaId).toHaveBeenCalledWith('ws', '5511999998888')
  })

  it('allows a number that is not a known contact', async () => {
    repo.findByWaId.mockResolvedValue(ok(null))
    expect(await checkWhatsAppOptOut('ws', '5511999998888')).toBe('allowed')
  })

  it('reports an opted-out contact', async () => {
    repo.findByWaId.mockResolvedValue(
      ok({ broadcastOptedOutAt: new Date() } as never),
    )
    expect(await checkWhatsAppOptOut('ws', '5511999998888')).toBe('opted_out')
  })

  it('fails closed when the lookup fails', async () => {
    repo.findByWaId.mockResolvedValue(err(databaseError()))
    expect(await checkWhatsAppOptOut('ws', '5511999998888')).toBe('unverified')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.opt_out.lookup_failed',
      expect.objectContaining({ workspaceId: 'ws' }),
    )
  })
})
