import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeDocumentRecipient,
  createFakePublicContext,
  sampleDocumentContent,
} from '@/src/__tests__/factories/document-backend.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { documentLinkUnavailable } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/services/document-access', () => ({
  resolveDocumentToken: vi.fn(),
}))
vi.mock('@/src/services/document-variables.service', () => ({
  DocumentVariablesService: { forDocument: vi.fn() },
}))
vi.mock('@/src/services/document-notifications', () => ({
  documentPath: (id: string) => `/crm/documents/${id}`,
  notifyDocumentAnswered: vi.fn(async () => 1),
}))
vi.mock('@/src/services/document-crm-sync', () => ({
  advanceOpportunityOnAccept: vi.fn(async () => ({ won: true })),
}))
vi.mock('@/src/services/steel-agent-dispatcher', () => ({
  dispatchSteelAgentEvent: vi.fn(async () => 0),
}))
vi.mock('@/src/lib/mail/documents/send-document-emails', () => ({
  sendDocumentAnsweredEmail: vi.fn(),
}))
vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/repositories/document-recipient.repository')
vi.mock('@/src/repositories/document-response.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendDocumentAnsweredEmail } from '@/src/lib/mail/documents/send-document-emails'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { DocumentResponseRepository } from '@/src/repositories/document-response.repository'
import { resolveDocumentToken } from '../document-access'
import { advanceOpportunityOnAccept } from '../document-crm-sync'
import { notifyDocumentAnswered } from '../document-notifications'
import { DocumentPublicService } from '../document-public.service'
import { DocumentVariablesService } from '../document-variables.service'
import { dispatchSteelAgentEvent } from '../steel-agent-dispatcher'

const resolve = vi.mocked(resolveDocumentToken)
const variables = vi.mocked(DocumentVariablesService)
const documentRepo = vi.mocked(DocumentRepository)
const recipientRepo = vi.mocked(DocumentRecipientRepository)
const responseRepo = vi.mocked(DocumentResponseRepository)
const notify = vi.mocked(notifyDocumentAnswered)
const advance = vi.mocked(advanceOpportunityOnAccept)
const dispatch = vi.mocked(dispatchSteelAgentEvent)
const ownerEmail = vi.mocked(sendDocumentAnsweredEmail)
const audit = vi.mocked(auditMutation)

const DAY_MS = 86_400_000
const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
const EVIDENCE = { ip: '203.0.113.7', userAgent: CHROME }

const content = sampleDocumentContent({ fields: true, pricing: true })

function context(overrides?: Parameters<typeof createFakePublicContext>[0]) {
  return createFakePublicContext(
    { id: 'd1', workspaceId: 'ws1', ownerId: 'owner', ...overrides },
    { id: 'v1', number: 2, content: content as never },
  )
}

function access(recipientId: string | null = null) {
  return ok({
    documentId: 'd1',
    workspaceId: 'ws1',
    recipientId,
    versionId: 'v1',
  })
}

const VALID_FIELDS = { 'field-name': 'Maria Souza', 'field-cpf': '' }

beforeEach(() => {
  resolve.mockResolvedValue(access())
  documentRepo.findPublicContext.mockResolvedValue(ok(context()))
  documentRepo.markViewed.mockResolvedValue(ok({ firstView: true }))
  recipientRepo.markViewed.mockResolvedValue(ok(undefined))
  variables.forDocument.mockResolvedValue(ok({ 'contato.nome': 'Maria' }))
  responseRepo.answer.mockResolvedValue(ok({ id: 'resp1' } as never))
  responseRepo.hasAnswer.mockResolvedValue(ok(false))
  ownerEmail.mockResolvedValue({ id: 'mail' } as never)
})

describe('DocumentPublicService.getByToken()', () => {
  it('returns the frozen version with variables, no view recorded by default', async () => {
    const dto = expectOk(await DocumentPublicService.getByToken('tok'))
    expect(dto.version).toMatchObject({ id: 'v1', number: 2 })
    expect(dto.variables).toEqual({ 'contato.nome': 'Maria' })
    expect(dto.canAccept).toBe(true)
    expect(documentRepo.markViewed).not.toHaveBeenCalled()
  })

  it('records the first read of a personal link for a real browser', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', role: 'VIEWER' })),
    )
    const dto = expectOk(
      await DocumentPublicService.getByToken('tok', {
        recordView: true,
        userAgent: CHROME,
      }),
    )
    expect(documentRepo.markViewed).toHaveBeenCalledWith('d1', expect.any(Date))
    expect(recipientRepo.markViewed).toHaveBeenCalledWith(
      'r1',
      expect.any(Date),
    )
    expect(dto.canAccept).toBe(false)
    expect(variables.forDocument).toHaveBeenCalledWith('d1', 'r1')
  })

  it('skips link previews', async () => {
    expectOk(
      await DocumentPublicService.getByToken('tok', {
        recordView: true,
        userAgent: 'WhatsApp/2.23',
      }),
    )
    expect(documentRepo.markViewed).not.toHaveBeenCalled()
  })

  it('reads an expired document as EXPIRED', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ validUntil: new Date(Date.now() - 3 * DAY_MS) })),
    )
    const dto = expectOk(await DocumentPublicService.getByToken('tok'))
    expect(dto.document.status).toBe('EXPIRED')
  })

  it('propagates unavailable links and failures', async () => {
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.getByToken('tok'),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
    expectErr(
      await DocumentPublicService.getByToken('tok', { recordView: true }),
      'DOCUMENT_LINK_UNAVAILABLE',
    )

    resolve.mockResolvedValue(access())
    documentRepo.markViewed.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.getByToken('tok', {
        recordView: true,
        userAgent: CHROME,
      }),
      'DATABASE_ERROR',
    )

    documentRepo.findPublicContext.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentPublicService.getByToken('tok'), 'DATABASE_ERROR')

    documentRepo.findPublicContext.mockResolvedValue(
      ok({ ...context(), currentVersion: null }),
    )
    expectErr(
      await DocumentPublicService.getByToken('tok'),
      'DOCUMENT_LINK_UNAVAILABLE',
    )

    documentRepo.findPublicContext.mockResolvedValue(ok(context()))
    variables.forDocument.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentPublicService.getByToken('tok'), 'DATABASE_ERROR')

    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentPublicService.getByToken('tok'), 'DATABASE_ERROR')
  })
})

describe('DocumentPublicService.recordOpen()', () => {
  it('marks the read and tells whether it was the first one', async () => {
    resolve.mockResolvedValue(access('r1'))
    expect(
      expectOk(await DocumentPublicService.recordOpen('tok', CHROME)),
    ).toEqual({ firstView: true })
    expect(
      expectOk(await DocumentPublicService.recordOpen('tok', null)),
    ).toEqual({ firstView: false })
  })

  it('propagates errors', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.markViewed.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.recordOpen('tok', CHROME),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.recordOpen('tok', CHROME),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })
})

describe('DocumentPublicService.identify()', () => {
  const reader = { name: 'Ana Leitora', email: 'Ana@Example.com' }

  it('creates a personal link for a new reader of the generic link', async () => {
    recipientRepo.findIdentified.mockResolvedValue(ok(null))
    recipientRepo.createMany.mockResolvedValue(
      ok([createFakeDocumentRecipient({ id: 'r9', token: 'personal' })]),
    )
    const result = expectOk(await DocumentPublicService.identify('tok', reader))
    expect(result).toMatchObject({ token: 'personal', recipientId: 'r9' })
    expect(result.url).toMatch(/\/d\/personal$/)
    expect(recipientRepo.findIdentified).toHaveBeenCalledWith(
      'd1',
      'ana@example.com',
    )
    expect(recipientRepo.createMany.mock.calls[0][2][0]).toMatchObject({
      name: 'Ana Leitora',
      email: 'ana@example.com',
      role: 'APPROVER',
      channel: 'LINK',
    })
  })

  it('reuses the link of a reader already identified', async () => {
    recipientRepo.findIdentified.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r3', token: 'again' })),
    )
    expect(
      expectOk(await DocumentPublicService.identify('tok', reader)).token,
    ).toBe('again')
    expect(recipientRepo.createMany).not.toHaveBeenCalled()
  })

  it('answers a personal token with itself', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', token: 'mine' })),
    )
    expect(
      expectOk(await DocumentPublicService.identify('mine', reader)).token,
    ).toBe('mine')
  })

  it('propagates errors', async () => {
    recipientRepo.findIdentified.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.identify('tok', reader),
      'DATABASE_ERROR',
    )
    recipientRepo.findIdentified.mockResolvedValue(ok(null))
    recipientRepo.createMany.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.identify('tok', reader),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.identify('tok', reader),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.identify('tok', reader),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })
})

describe('DocumentPublicService.accept()', () => {
  const input = {
    name: 'Maria Souza',
    email: 'Maria@Example.com',
    agreed: true as const,
    fields: VALID_FIELDS,
    selection: {
      extra: { selected: true, quantity: 1 },
      seats: { selected: true, quantity: 5 },
      ghost: { selected: true, quantity: 99 },
    },
    versionId: 'v1',
  }

  it('records the accept with evidence and runs the follow-ups', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ kind: 'PROPOSAL', opportunityId: 'opp1' })),
    )
    expectOk(await DocumentPublicService.accept('tok', EVIDENCE, input))

    const answer = responseRepo.answer.mock.calls[0][0]
    expect(answer).toMatchObject({
      documentId: 'd1',
      workspaceId: 'ws1',
      versionId: 'v1',
      recipientId: null,
      action: 'ACCEPT',
      name: 'Maria Souza',
      email: 'maria@example.com',
      fields: { 'field-name': 'Maria Souza' },
      selection: {
        extra: { selected: true, quantity: 1 },
        seats: { selected: true, quantity: 5 },
      },
      totalValue: 2000,
      reason: null,
      userAgent: CHROME,
    })
    expect(answer.ipHash).toMatch(/^[0-9a-f]{64}$/)
    expect(answer.ipHash).not.toContain('203')
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ACCEPT', readerName: 'Maria Souza' }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      'ws1',
      'crm.document.accepted',
      expect.objectContaining({ documentId: 'd1', totalValue: 2000 }),
    )
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'opp1',
        acceptedByName: 'Maria Souza',
        authorId: 'owner',
      }),
    )
    await vi.waitFor(() =>
      expect(ownerEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'joao@example.com',
          action: 'ACCEPT',
          totalLabel: 'R$ 2.000,00',
          documentUrl: expect.stringContaining(
            '/stratus-lab/crm/documents/d1',
          ),
        }),
      ),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept', actorId: null }),
    )
  })

  it('does not move an opportunity for documents that are not proposals', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ kind: 'CONTRACT', opportunityId: 'opp1' })),
    )
    expectOk(await DocumentPublicService.accept('tok', EVIDENCE, input))
    expect(advance).not.toHaveBeenCalled()
  })

  it('uses the recipient e-mail and keeps a null total without prices', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', email: 'r1@example.com' })),
    )
    documentRepo.findPublicContext.mockResolvedValue(
      ok(
        createFakePublicContext(
          { id: 'd1', workspaceId: 'ws1' },
          { id: 'v1', content: sampleDocumentContent() as never },
        ),
      ),
    )
    expectOk(
      await DocumentPublicService.accept('tok', EVIDENCE, {
        ...input,
        email: undefined,
        fields: {},
      }),
    )
    expect(responseRepo.answer.mock.calls[0][0]).toMatchObject({
      recipientId: 'r1',
      email: 'r1@example.com',
      totalValue: null,
    })
  })

  it('logs a failed owner e-mail without failing the accept', async () => {
    ownerEmail.mockRejectedValue(new Error('smtp down'))
    expectOk(await DocumentPublicService.accept('tok', EVIDENCE, input))
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        'documents.public.owner_email_failed',
        expect.objectContaining({ documentId: 'd1' }),
      ),
    )
  })

  it('refuses answered, expired, stale and VIEWER answers', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'ACCEPTED' })),
    )
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'DECLINED' })),
    )
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'EXPIRED' })),
    )
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_EXPIRED',
    )
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ validUntil: new Date(Date.now() - 3 * DAY_MS) })),
    )
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_EXPIRED',
    )
    documentRepo.findPublicContext.mockResolvedValue(ok(context()))
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, {
        ...input,
        versionId: 'v0',
      }),
      'DOCUMENT_VERSION_STALE',
    )
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', role: 'VIEWER' })),
    )
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_ACCEPT_NOT_ALLOWED',
    )
    expect(responseRepo.answer).not.toHaveBeenCalled()
  })

  it('refuses invalid fields with the error of each field', async () => {
    const error = expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, {
        ...input,
        fields: { 'field-cpf': '123' },
      }),
      'DOCUMENT_FIELDS_INVALID',
    )
    expect(error.message).toBe('"Nome completo" é obrigatório')
    expect(error.details).toEqual({
      fields: {
        'field-name': '"Nome completo" é obrigatório',
        'field-cpf': '"CPF" tem um CPF inválido',
      },
    })
  })

  it('answers DOCUMENT_ALREADY_ANSWERED when another answer won the race', async () => {
    responseRepo.answer.mockResolvedValue(ok(null))
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('propagates database and link errors', async () => {
    responseRepo.answer.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.accept('tok', EVIDENCE, input),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })

  it('reads malformed version content as a document without fields', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(
        createFakePublicContext(
          { id: 'd1', workspaceId: 'ws1' },
          { id: 'v1', content: 'broken' },
        ),
      ),
    )
    expectOk(
      await DocumentPublicService.accept('tok', EVIDENCE, {
        ...input,
        fields: {},
      }),
    )
  })
})

describe('DocumentPublicService.decline()', () => {
  it('records the decline with the reason and notifies the owner', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', name: 'Carlos' })),
    )
    expectOk(
      await DocumentPublicService.decline('tok', EVIDENCE, {
        reason: 'Preço alto',
        versionId: 'v1',
      }),
    )
    expect(responseRepo.answer.mock.calls[0][0]).toMatchObject({
      action: 'DECLINE',
      name: 'Carlos',
      reason: 'Preço alto',
      totalValue: null,
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DECLINE', readerName: 'Carlos' }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      'ws1',
      'crm.document.declined',
      expect.any(Object),
    )
    expect(advance).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject' }),
    )
  })

  it('names an anonymous reader of the generic link', async () => {
    expectOk(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v1' }),
    )
    expect(responseRepo.answer.mock.calls[0][0]).toMatchObject({
      name: null,
      reason: null,
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ readerName: 'O leitor do link' }),
    )
  })

  it('refuses answered, stale, VIEWER and failed declines', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'ACCEPTED' })),
    )
    expectErr(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v1' }),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    documentRepo.findPublicContext.mockResolvedValue(ok(context()))
    expectErr(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v0' }),
      'DOCUMENT_VERSION_STALE',
    )
    responseRepo.answer.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v1' }),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', role: 'VIEWER' })),
    )
    expectErr(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v1' }),
      'DOCUMENT_ACCEPT_NOT_ALLOWED',
    )
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.decline('tok', EVIDENCE, { versionId: 'v1' }),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })
})

describe('DocumentPublicService.submit()', () => {
  const input = {
    fields: VALID_FIELDS,
    selection: {},
    versionId: 'v1',
  }

  it('records the fields of a VIEWER without changing the status', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(
        createFakeDocumentRecipient({
          id: 'r1',
          role: 'VIEWER',
          name: 'Ana',
          email: 'ana@example.com',
        }),
      ),
    )
    expectOk(await DocumentPublicService.submit('tok', EVIDENCE, input))
    expect(responseRepo.hasAnswer).toHaveBeenCalledWith('d1', 'r1', 'SUBMIT')
    expect(responseRepo.answer.mock.calls[0][0]).toMatchObject({
      action: 'SUBMIT',
      name: 'Ana',
      email: 'ana@example.com',
      totalValue: 1200,
    })
    expect(notify).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'respond' }),
    )
  })

  it('accepts the name and e-mail typed on the generic link', async () => {
    expectOk(
      await DocumentPublicService.submit('tok', EVIDENCE, {
        ...input,
        name: 'Paulo',
        email: 'Paulo@Example.com',
      }),
    )
    expect(responseRepo.hasAnswer).not.toHaveBeenCalled()
    expect(responseRepo.answer.mock.calls[0][0]).toMatchObject({
      name: 'Paulo',
      email: 'paulo@example.com',
      recipientId: null,
    })
  })

  it('refuses a second submission, a document without fields and bad fields', async () => {
    resolve.mockResolvedValue(access('r1'))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1' })),
    )
    responseRepo.hasAnswer.mockResolvedValue(ok(true))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    responseRepo.hasAnswer.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DATABASE_ERROR',
    )

    resolve.mockResolvedValue(access())
    documentRepo.findPublicContext.mockResolvedValue(
      ok(
        createFakePublicContext(
          { id: 'd1', workspaceId: 'ws1' },
          { id: 'v1', content: sampleDocumentContent() as never },
        ),
      ),
    )
    const empty = expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DOCUMENT_FIELDS_INVALID',
    )
    expect(empty.message).toBe('Este documento não tem campos para enviar')

    documentRepo.findPublicContext.mockResolvedValue(ok(context()))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, {
        ...input,
        fields: {},
      }),
      'DOCUMENT_FIELDS_INVALID',
    )
  })

  it('refuses answered, expired and stale submissions', async () => {
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'DECLINED' })),
    )
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DOCUMENT_ALREADY_ANSWERED',
    )
    documentRepo.findPublicContext.mockResolvedValue(
      ok(context({ status: 'EXPIRED' })),
    )
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DOCUMENT_EXPIRED',
    )
    documentRepo.findPublicContext.mockResolvedValue(ok(context()))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, {
        ...input,
        versionId: 'v0',
      }),
      'DOCUMENT_VERSION_STALE',
    )
    responseRepo.answer.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DATABASE_ERROR',
    )
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentPublicService.submit('tok', EVIDENCE, input),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })
})
