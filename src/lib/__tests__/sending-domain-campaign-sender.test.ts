import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/sending-domain.repository', () => ({
  SendingDomainRepository: { findVerifiedByName: vi.fn() },
}))

import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import {
  campaignSenderBlockedMessage,
  checkCampaignSender,
} from '../sending-domain/campaign-sender'
import {
  isPlatformCampaignSender,
  PLATFORM_CAMPAIGN_DOMAIN,
} from '../sending-domain/platform-sender'

const findVerifiedByName = vi.mocked(SendingDomainRepository.findVerifiedByName)

describe('checkCampaignSender', () => {
  beforeEach(() => findVerifiedByName.mockReset())

  it('accepts any address on the platform domain without a lookup', async () => {
    expect(PLATFORM_CAMPAIGN_DOMAIN).toBe('stratustelecom.com.br')
    expect(isPlatformCampaignSender(' Vendas@StratusTelecom.com.br ')).toBe(
      true,
    )
    for (const from of [
      'notificacoes@stratustelecom.com.br',
      'contato@stratustelecom.com.br',
    ]) {
      expect(await checkCampaignSender('ws_1', from)).toEqual(
        ok({ platform: true }),
      )
    }
    expect(findVerifiedByName).not.toHaveBeenCalled()
  })

  it('matches the platform domain exactly', () => {
    expect(isPlatformCampaignSender('a@news.stratustelecom.com.br')).toBe(false)
    expect(isPlatformCampaignSender('a@stratustelecom.com.br.evil.com')).toBe(
      false,
    )
    expect(isPlatformCampaignSender('stratustelecom.com.br')).toBe(false)
    expect(isPlatformCampaignSender('@stratustelecom.com.br')).toBe(false)
  })

  it('accepts an address on a verified domain of the workspace', async () => {
    findVerifiedByName.mockResolvedValue(ok({ id: 'dom_1' } as never))
    expect(await checkCampaignSender('ws_1', 'mkt@news.acme.com')).toEqual(
      ok({ platform: false }),
    )
    expect(findVerifiedByName).toHaveBeenCalledWith('ws_1', 'news.acme.com')
  })

  it('refuses an unverified domain with the pt-BR checklist message', async () => {
    findVerifiedByName.mockResolvedValue(ok(null))
    const result = await checkCampaignSender('ws_1', 'mkt@acme.com')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SENDING_DOMAIN_NOT_VERIFIED')
      expect(result.error.message).toBe(
        campaignSenderBlockedMessage('mkt@acme.com'),
      )
      expect(result.error.message).toContain('Ajustes › Domínios de e-mail')
    }
  })

  it('propagates a database error', async () => {
    findVerifiedByName.mockResolvedValue(err(databaseError()))
    const result = await checkCampaignSender('ws_1', 'mkt@acme.com')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DATABASE_ERROR')
  })
})
