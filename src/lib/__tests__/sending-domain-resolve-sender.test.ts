import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/sending-domain.repository', () => ({
  SendingDomainRepository: { findVerifiedByName: vi.fn() },
}))

import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import { resolveVerifiedSender } from '../sending-domain/resolve-sender'

const findVerifiedByName = vi.mocked(SendingDomainRepository.findVerifiedByName)

describe('resolveVerifiedSender', () => {
  beforeEach(() => findVerifiedByName.mockReset())

  it('returns the domain id when the exact domain is verified', async () => {
    findVerifiedByName.mockResolvedValue(ok({ id: 'dom_1' } as never))
    const result = await resolveVerifiedSender('ws_1', 'News@News.Acme.com')
    expect(findVerifiedByName).toHaveBeenCalledWith('ws_1', 'news.acme.com')
    expect(result).toEqual({ ok: true, value: { sendingDomainId: 'dom_1' } })
  })

  it('refuses a domain that is not verified', async () => {
    findVerifiedByName.mockResolvedValue(ok(null))
    const result = await resolveVerifiedSender('ws_1', 'a@acme.com')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SENDING_DOMAIN_NOT_VERIFIED')
      expect(result.error.message).toContain('acme.com')
    }
  })

  it('refuses an address without a domain without querying', async () => {
    const result = await resolveVerifiedSender('ws_1', 'nobody')
    expect(result.ok).toBe(false)
    expect(findVerifiedByName).not.toHaveBeenCalled()
  })

  it('propagates a database error', async () => {
    findVerifiedByName.mockResolvedValue(err(databaseError('boom')))
    const result = await resolveVerifiedSender('ws_1', 'a@acme.com')
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'DATABASE_ERROR' }),
    })
  })
})
