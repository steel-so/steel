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

  it('treats an unknown, empty or oversized token as unavailable', async () => {
    mockedRepo.findLink.mockResolvedValue(ok(null))
    expectErr(await resolveDocumentToken('nope'), 'DOCUMENT_LINK_UNAVAILABLE')
    expectErr(await resolveDocumentToken(''), 'DOCUMENT_LINK_UNAVAILABLE')
    expectErr(
      await resolveDocumentToken('x'.repeat(129)),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
    expect(mockedRepo.findLink).toHaveBeenCalledTimes(1)
  })

  it('keeps personal links working when the generic link is off', async () => {
    mockedRepo.findLink.mockResolvedValue(ok(link({ linkEnabled: false })))
    expectOk(await resolveDocumentToken('tok'))
  })

  it('propagates database errors', async () => {
    mockedRepo.findLink.mockResolvedValue(err(databaseError()))
    expectErr(await resolveDocumentToken('tok'), 'DATABASE_ERROR')
  })

  it.each([
    ['deleted', { deleted: true }],
    ['a template', { isTemplate: true }],
    ['the generic link is off', { linkEnabled: false, recipientId: null }],
    ['never sent', { versionId: null }],
    ['archived', { status: 'ARCHIVED' }],
  ] as const)('is unavailable when %s', async (_label, overrides) => {
    mockedRepo.findLink.mockResolvedValue(ok(link(overrides)))
    expectErr(await resolveDocumentToken('tok'), 'DOCUMENT_LINK_UNAVAILABLE')
  })
})
