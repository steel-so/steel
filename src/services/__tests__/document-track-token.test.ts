import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/document-track.repository')

import {
  type DocumentLinkRow,
  DocumentTrackRepository,
} from '@/src/repositories/document-track.repository'
import { resolveDocumentToken } from '../document-track-token'

const mockedRepo = vi.mocked(DocumentTrackRepository)

function link(overrides: Partial<DocumentLinkRow> = {}): DocumentLinkRow {
  return {
    documentId: 'doc-1',
    workspaceId: 'ws-1',
    recipientId: 'rcp-1',
    versionId: 'ver-1',
    isTemplate: false,
    linkEnabled: true,
    status: 'SENT',
    deleted: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveDocumentToken (local adapter)', () => {
  it('resolves a sent document link', async () => {
    mockedRepo.findLink.mockResolvedValue(ok(link()))
    expect(expectOk(await resolveDocumentToken('tok'))).toEqual({
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      recipientId: 'rcp-1',
      versionId: 'ver-1',
    })
    expect(mockedRepo.findLink).toHaveBeenCalledWith('tok')
  })

  it('returns DOCUMENT_NOT_FOUND for an unknown token', async () => {
    mockedRepo.findLink.mockResolvedValue(ok(null))
    expectErr(await resolveDocumentToken('nope'), 'DOCUMENT_NOT_FOUND')
  })

  it('propagates database errors', async () => {
    mockedRepo.findLink.mockResolvedValue(err(databaseError()))
    expectErr(await resolveDocumentToken('tok'), 'DATABASE_ERROR')
  })

  it.each([
    ['deleted', { deleted: true }],
    ['a template', { isTemplate: true }],
    ['with the link off', { linkEnabled: false }],
    ['never sent', { versionId: null }],
    ['archived', { status: 'ARCHIVED' as const }],
  ])('is DOCUMENT_LINK_UNAVAILABLE when %s', async (_label, overrides) => {
    mockedRepo.findLink.mockResolvedValue(ok(link(overrides)))
    expectErr(await resolveDocumentToken('tok'), 'DOCUMENT_LINK_UNAVAILABLE')
  })
})
