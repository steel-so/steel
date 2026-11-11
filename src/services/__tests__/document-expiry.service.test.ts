import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDocument } from '@/src/__tests__/factories/document-backend.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { DocumentExpirationCandidate } from '@/src/repositories/document.repository'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/services/crm-settings.service', () => ({
  CrmSettingsService: { resolve: vi.fn() },
}))
vi.mock('@/src/services/document-notifications', () => ({
  documentPath: (id: string) => `/crm/documents/${id}`,
  notifyDocumentExpired: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/mail/documents/send-document-emails', () => ({
  sendDocumentExpiredEmail: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendDocumentExpiredEmail } from '@/src/lib/mail/documents/send-document-emails'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { CrmSettingsService } from '../crm-settings.service'
import { notifyDocumentExpired } from '../document-notifications'
import { DocumentExpiryService } from '../document-expiry.service'

const documentRepo = vi.mocked(DocumentRepository)
const settings = vi.mocked(CrmSettingsService)
const notify = vi.mocked(notifyDocumentExpired)
const sendEmail = vi.mocked(sendDocumentExpiredEmail)
const audit = vi.mocked(auditMutation)

const NOW = new Date('2026-11-12T03:10:00.000Z')
const YESTERDAY = new Date('2026-11-10T15:00:00.000Z')

function candidate(
  overrides?: Partial<DocumentExpirationCandidate>,
): DocumentExpirationCandidate {
  const doc = createFakeDocument({
    status: 'SENT',
    validUntil: YESTERDAY,
    workspaceId: 'ws1',
    ownerId: 'owner',
    ...overrides,
  })
  return {
    ...doc,
    owner: { id: 'owner', name: 'João', email: 'joao@example.com' },
    workspace: { id: doc.workspaceId, name: 'Stratus Lab', slug: 'lab' },
    ...overrides,
  }
}

function crmSettings(notifyProposalExpiry: boolean) {
  return ok({
    leadReopenStage: null,
    proposalValidityDays: 15,
    notifyProposalExpiry,
  } as never)
}

beforeEach(() => {
  documentRepo.markExpired.mockResolvedValue(ok(true))
  settings.resolve.mockResolvedValue(crmSettings(true))
  sendEmail.mockResolvedValue({ id: 'mail' } as never)
})

describe('DocumentExpiryService.expireDue()', () => {
  it('expires overdue documents, notifies and e-mails the owner', async () => {
    documentRepo.listExpirationCandidates.mockResolvedValue(
      ok([candidate({ id: 'd1', title: 'Proposta' })]),
    )
    expect(expectOk(await DocumentExpiryService.expireDue(NOW))).toEqual({
      candidates: 1,
      expired: 1,
      notified: 1,
    })
    expect(documentRepo.markExpired).toHaveBeenCalledWith('d1', NOW)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ expiredAt: NOW, workspaceId: 'ws1' }),
    )
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'joao@example.com',
        documentTitle: 'Proposta',
        validUntil: '10/11/2026',
        documentUrl: expect.stringContaining('/lab/crm/documents/d1'),
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ via: 'documents-expiry' }),
      }),
    )
  })

  it('skips documents still valid today and those that changed meanwhile', async () => {
    documentRepo.listExpirationCandidates.mockResolvedValue(
      ok([
        candidate({ id: 'today', validUntil: new Date('2026-11-12T15:00Z') }),
        candidate({ id: 'raced' }),
      ]),
    )
    documentRepo.markExpired.mockResolvedValue(ok(false))
    expect(expectOk(await DocumentExpiryService.expireDue(NOW))).toEqual({
      candidates: 2,
      expired: 0,
      notified: 0,
    })
    expect(documentRepo.markExpired).toHaveBeenCalledTimes(1)
  })

  it('keeps going after a failed write, a settings error or an e-mail error', async () => {
    documentRepo.listExpirationCandidates.mockResolvedValue(
      ok([
        candidate({ id: 'broken' }),
        candidate({ id: 'no-settings', workspaceId: 'ws2' }),
        candidate({ id: 'mail-fails', workspaceId: 'ws3' }),
        candidate({ id: 'muted', workspaceId: 'ws4', validUntil: null }),
      ]),
    )
    documentRepo.markExpired
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValue(ok(true))
    settings.resolve
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(crmSettings(true))
      .mockResolvedValueOnce(crmSettings(false))
    sendEmail.mockRejectedValueOnce(new Error('smtp down'))

    expect(expectOk(await DocumentExpiryService.expireDue(NOW))).toEqual({
      candidates: 4,
      expired: 2,
      notified: 0,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'documents.expiry.expire_failed',
      expect.objectContaining({ documentId: 'broken' }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'documents.expiry.email_failed',
      expect.objectContaining({ documentId: 'mail-fails' }),
    )
  })

  it('caches the settings per workspace', async () => {
    const past = new Date('2026-11-01T12:00:00.000Z')
    documentRepo.listExpirationCandidates.mockResolvedValue(
      ok([
        candidate({ id: 'a', validUntil: past }),
        candidate({ id: 'b', validUntil: past }),
      ]),
    )
    expectOk(await DocumentExpiryService.expireDue(NOW))
    expect(settings.resolve).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it('propagates a failed batch read', async () => {
    documentRepo.listExpirationCandidates.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(await DocumentExpiryService.expireDue(NOW), 'DATABASE_ERROR')
  })

  it('defaults to the current time', async () => {
    documentRepo.listExpirationCandidates.mockResolvedValue(ok([]))
    expectOk(await DocumentExpiryService.expireDue())
    expect(documentRepo.listExpirationCandidates).toHaveBeenCalledWith(
      expect.any(Date),
    )
  })
})
