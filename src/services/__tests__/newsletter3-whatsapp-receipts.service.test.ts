import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeReceiptTarget } from '@/src/__tests__/factories/newsletter3-whatsapp-receipts.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger')
vi.mock('@/src/repositories/crm-newsletter-whatsapp.repository')
vi.mock('@/src/services/crm-newsletter-bridge.service', () => ({
  CrmNewsletterBridge: { emit: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { CrmNewsletterWhatsAppRepository } from '@/src/repositories/crm-newsletter-whatsapp.repository'
import { CrmNewsletterBridge } from '../crm-newsletter-bridge.service'
import { CrmNewsletterWhatsAppReceiptsService as Receipts } from '../crm-newsletter-whatsapp-receipts.service'

const repo = vi.mocked(CrmNewsletterWhatsAppRepository)
const emit = vi.mocked(CrmNewsletterBridge.emit)
const AT = new Date('2026-10-29T12:00:00.000Z')

function input(
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'PENDING',
  error?: string | null,
) {
  return { providerMessageId: 'wamid.1', status, at: AT, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findByProviderMessageId.mockResolvedValue(ok(createFakeReceiptTarget()))
  repo.applyReceipt.mockResolvedValue(ok(true))
  emit.mockResolvedValue(undefined)
})

describe('CrmNewsletterWhatsAppReceiptsService.onWhatsAppStatus', () => {
  it('ignores statuses that are not receipts and empty ids', async () => {
    expect(await Receipts.onWhatsAppStatus(input('SENT'))).toBe(false)
    expect(await Receipts.onWhatsAppStatus(input('PENDING'))).toBe(false)
    expect(
      await Receipts.onWhatsAppStatus({
        ...input('READ'),
        providerMessageId: '',
      }),
    ).toBe(false)
    expect(repo.findByProviderMessageId).not.toHaveBeenCalled()
  })

  it('ignores messages that are not newsletter recipients', async () => {
    repo.findByProviderMessageId.mockResolvedValue(ok(null))
    expect(await Receipts.onWhatsAppStatus(input('DELIVERED'))).toBe(false)
    expect(repo.applyReceipt).not.toHaveBeenCalled()
  })

  it('stamps delivered without touching the timeline', async () => {
    expect(await Receipts.onWhatsAppStatus(input('DELIVERED'))).toBe(true)
    expect(repo.findByProviderMessageId).toHaveBeenCalledWith('wamid.1')
    expect(repo.applyReceipt).toHaveBeenCalledWith(
      'w1',
      'DELIVERED',
      AT,
      undefined,
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('stamps the first read and logs it on the CRM timeline', async () => {
    expect(await Receipts.onWhatsAppStatus(input('READ'))).toBe(true)
    expect(repo.applyReceipt).toHaveBeenCalledWith('w1', 'READ', AT, undefined)
    expect(emit).toHaveBeenCalledWith({
      type: 'issue_whatsapp_read',
      subscriberId: 's1',
      issueId: 'is1',
    })
  })

  it('does not re-log a repeated or late receipt', async () => {
    repo.applyReceipt.mockResolvedValue(ok(false))
    expect(await Receipts.onWhatsAppStatus(input('READ'))).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('records a provider failure with its detail', async () => {
    expect(
      await Receipts.onWhatsAppStatus(input('FAILED', '131026: Undeliverable')),
    ).toBe(true)
    expect(repo.applyReceipt).toHaveBeenCalledWith(
      'w1',
      'FAILED',
      AT,
      '131026: Undeliverable',
    )
    expect(logger.info).toHaveBeenCalledWith(
      'crm.newsletter.whatsapp_failed_receipt',
      expect.objectContaining({
        recipientId: 'w1',
        error: '131026: Undeliverable',
      }),
    )
    vi.mocked(logger.info).mockClear()
    await Receipts.onWhatsAppStatus(input('FAILED'))
    expect(logger.info).toHaveBeenCalledWith(
      'crm.newsletter.whatsapp_failed_receipt',
      expect.objectContaining({ error: null }),
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('logs and swallows repository errors (lookup and update)', async () => {
    repo.findByProviderMessageId.mockResolvedValueOnce(
      err(databaseError('down')),
    )
    expect(await Receipts.onWhatsAppStatus(input('READ'))).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.newsletter.whatsapp_receipt_failed',
      expect.objectContaining({ status: 'READ', error: 'DATABASE_ERROR' }),
    )
    repo.applyReceipt.mockResolvedValueOnce(err(databaseError('down')))
    expect(await Receipts.onWhatsAppStatus(input('DELIVERED'))).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('never throws, even when a dependency does', async () => {
    repo.findByProviderMessageId.mockRejectedValueOnce(new Error('boom'))
    expect(await Receipts.onWhatsAppStatus(input('READ'))).toBe(false)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'crm.newsletter.whatsapp_receipt_failed',
      expect.objectContaining({ error: 'boom' }),
    )
    emit.mockRejectedValueOnce('plain')
    expect(await Receipts.onWhatsAppStatus(input('READ'))).toBe(false)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'crm.newsletter.whatsapp_receipt_failed',
      expect.objectContaining({ error: 'plain' }),
    )
  })
})
