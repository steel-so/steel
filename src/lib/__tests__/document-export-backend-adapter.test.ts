import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const mocks = vi.hoisted(() => ({
  prisma: {
    documentRecipient: { findUnique: vi.fn() },
    document: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))

import {
  DocumentVariablesService,
  resolveDocumentToken,
} from '@/src/lib/document-export/backend-adapter'

const sent = {
  id: 'doc-1',
  workspaceId: 'ws-1',
  currentVersionId: 'ver-1',
  linkEnabled: true,
  status: 'SENT',
  deletedAt: null,
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('resolveDocumentToken (local adapter)', () => {
  it('should resolve a recipient token to its document', async () => {
    mocks.prisma.documentRecipient.findUnique.mockResolvedValue({
      id: 'rcpt-1',
      documentId: 'doc-1',
    })
    mocks.prisma.document.findFirst.mockResolvedValue(sent)
    expect(expectOk(await resolveDocumentToken('rcpt-token'))).toEqual({
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      recipientId: 'rcpt-1',
      versionId: 'ver-1',
    })
    expect(mocks.prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1' } }),
    )
  })

  it('should resolve the generic link by the public token', async () => {
    mocks.prisma.documentRecipient.findUnique.mockResolvedValue(null)
    mocks.prisma.document.findFirst.mockResolvedValue(sent)
    expect(
      expectOk(await resolveDocumentToken('pub-token')).recipientId,
    ).toBeNull()
    expect(mocks.prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicToken: 'pub-token' } }),
    )
  })

  it.each([
    ['unknown', null],
    ['never sent', { ...sent, currentVersionId: null }],
    ['with the link off', { ...sent, linkEnabled: false }],
    ['archived', { ...sent, status: 'ARCHIVED' }],
    ['deleted', { ...sent, deletedAt: new Date() }],
  ])('should refuse a document %s', async (_label, document) => {
    mocks.prisma.documentRecipient.findUnique.mockResolvedValue(null)
    mocks.prisma.document.findFirst.mockResolvedValue(document)
    expectErr(await resolveDocumentToken('t'), 'DOCUMENT_LINK_UNAVAILABLE')
  })

  it('should return DATABASE_ERROR when the lookup fails', async () => {
    mocks.prisma.documentRecipient.findUnique.mockRejectedValue(new Error('x'))
    expectErr(await resolveDocumentToken('t'), 'DATABASE_ERROR')
  })
})

describe('DocumentVariablesService.forDocument (local adapter)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T12:00:00.000Z'))
  })

  const document = {
    title: 'Proposta comercial',
    validUntil: new Date('2026-11-30T23:59:59.000Z'),
    totalValue: new Prisma.Decimal('48000.5'),
    workspace: { name: 'Stratus Telecom' },
    owner: { name: 'João Lima', email: 'joao@stratus.test' },
  }

  it('should format the values in pt-BR for a recipient', async () => {
    mocks.prisma.document.findUnique.mockResolvedValue(document)
    mocks.prisma.documentRecipient.findUnique.mockResolvedValue({
      name: 'Maria Souza',
      email: 'maria@cliente.test',
    })
    const values = expectOk(
      await DocumentVariablesService.forDocument('doc-1', 'rcpt-1'),
    )
    expect(values).toEqual({
      'documento.titulo': 'Proposta comercial',
      'workspace.nome': 'Stratus Telecom',
      'responsavel.nome': 'João Lima',
      'responsavel.email': 'joao@stratus.test',
      'data.hoje': '11/11/2026',
      'documento.validade': '30/11/2026',
      'documento.total': expect.stringMatching(/^R\$\s48\.000,50$/),
      'destinatario.nome': 'Maria Souza',
      'destinatario.email': 'maria@cliente.test',
    })
  })

  it('should leave out what the document does not have', async () => {
    mocks.prisma.document.findUnique.mockResolvedValue({
      ...document,
      validUntil: null,
      totalValue: null,
    })
    mocks.prisma.documentRecipient.findUnique.mockResolvedValue({
      name: 'Maria Souza',
      email: null,
    })
    const values = expectOk(
      await DocumentVariablesService.forDocument('doc-1', 'rcpt-1'),
    )
    expect(values).not.toHaveProperty('documento.validade')
    expect(values).not.toHaveProperty('documento.total')
    expect(values).not.toHaveProperty('destinatario.email')

    const generic = expectOk(
      await DocumentVariablesService.forDocument('doc-1', null),
    )
    expect(generic).not.toHaveProperty('destinatario.nome')
  })

  it('should fail for a missing document or a database error', async () => {
    mocks.prisma.document.findUnique.mockResolvedValueOnce(null)
    expectErr(
      await DocumentVariablesService.forDocument('doc-1', null),
      'DOCUMENT_NOT_FOUND',
    )
    mocks.prisma.document.findUnique.mockRejectedValueOnce(new Error('x'))
    expectErr(
      await DocumentVariablesService.forDocument('doc-1', null),
      'DATABASE_ERROR',
    )
  })
})
