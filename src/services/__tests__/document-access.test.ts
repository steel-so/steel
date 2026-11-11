import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDocumentRecipient } from '@/src/__tests__/factories/document-backend.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/repositories/document-recipient.repository')

import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { resolveDocumentToken } from '../document-access'

const documentRepo = vi.mocked(DocumentRepository)
const recipientRepo = vi.mocked(DocumentRecipientRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const target = (overrides?: object) => ({
  id: 'd1',
  workspaceId: 'ws1',
  status: 'SENT' as const,
  isTemplate: false,
  linkEnabled: true,
  currentVersionId: 'v1',
  ...overrides,
})

beforeEach(() => {
  recipientRepo.findByToken.mockResolvedValue(ok(null))
  documentRepo.findLinkTarget.mockResolvedValue(ok(target()))
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('resolveDocumentToken()', () => {
  it('resolves the generic token of a sent document', async () => {
    expect(expectOk(await resolveDocumentToken('generic'))).toEqual({
      documentId: 'd1',
      workspaceId: 'ws1',
      recipientId: null,
      versionId: 'v1',
    })
    expect(documentRepo.findLinkTarget).toHaveBeenCalledWith({
      publicToken: 'generic',
    })
  })

  it('resolves a personal token even with the generic link off', async () => {
    recipientRepo.findByToken.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', documentId: 'd1' })),
    )
    documentRepo.findLinkTarget.mockResolvedValue(
      ok(target({ linkEnabled: false })),
    )
    const access = expectOk(await resolveDocumentToken('personal'))
    expect(access.recipientId).toBe('r1')
    expect(documentRepo.findLinkTarget).toHaveBeenCalledWith({ id: 'd1' })
  })

  it('refuses unknown, unsent, archived, template and disabled links', async () => {
    expectErr(await resolveDocumentToken(''), 'DOCUMENT_LINK_UNAVAILABLE')
    expectErr(
      await resolveDocumentToken('x'.repeat(200)),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
    const cases = [
      null,
      target({ currentVersionId: null }),
      target({ status: 'DRAFT' }),
      target({ status: 'ARCHIVED' }),
      target({ isTemplate: true }),
      target({ linkEnabled: false }),
    ]
    for (const value of cases) {
      documentRepo.findLinkTarget.mockResolvedValue(ok(value))
      expectErr(await resolveDocumentToken('tok'), 'DOCUMENT_LINK_UNAVAILABLE')
    }
  })

  it('treats a disabled CRM module as an unavailable link', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await resolveDocumentToken('tok'), 'DOCUMENT_LINK_UNAVAILABLE')
  })

  it('propagates database errors', async () => {
    moduleAccess.isEnabled.mockResolvedValue(err(databaseError()))
    expectErr(await resolveDocumentToken('tok'), 'DATABASE_ERROR')
    documentRepo.findLinkTarget.mockResolvedValue(err(databaseError()))
    expectErr(await resolveDocumentToken('tok'), 'DATABASE_ERROR')
    recipientRepo.findByToken.mockResolvedValue(err(databaseError()))
    expectErr(await resolveDocumentToken('tok'), 'DATABASE_ERROR')
  })
})
