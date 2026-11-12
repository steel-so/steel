import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeDocumentFull,
  createFakeDocumentRecipient,
  createFakeDocumentVersion,
  sampleDocumentContent,
} from '@/src/__tests__/factories/document-backend.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import {
  documentNotFound,
  documentRecipientNotFound,
} from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok } from '@/src/lib/result'
import type { DocumentDeliveryDTO } from '@/types/document'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/repositories/document-event.repository')
vi.mock('@/src/repositories/document-recipient.repository')
vi.mock('@/src/repositories/document-version.repository')
vi.mock('@/src/services/document-delivery', () => ({
  deliverDocument: vi.fn(),
}))
vi.mock('@/src/lib/canvas-document/catalog', () => ({
  validateDocumentContent: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { validateDocumentContent } from '@/src/lib/canvas-document/catalog'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentEventRepository } from '@/src/repositories/document-event.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { DocumentVersionRepository } from '@/src/repositories/document-version.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { deliverDocument } from '../document-delivery'
import { DocumentSendService } from '../document-send.service'

const membershipRepo = vi.mocked(MembershipRepository)
const documentRepo = vi.mocked(DocumentRepository)
const eventRepo = vi.mocked(DocumentEventRepository)
const recipientRepo = vi.mocked(DocumentRecipientRepository)
const versionRepo = vi.mocked(DocumentVersionRepository)
const deliver = vi.mocked(deliverDocument)
const validate = vi.mocked(validateDocumentContent)
const audit = vi.mocked(auditMutation)

const DAY_MS = 86_400_000

function asRole(role: 'OWNER' | 'MEMBER' | 'VIEWER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const pricedContent = sampleDocumentContent({ pricing: true })

function sentDocument(
  overrides?: Parameters<typeof createFakeDocumentFull>[0],
) {
  return createFakeDocumentFull({
    id: 'd1',
    workspaceId: 'ws1',
    status: 'SENT',
    currentVersionId: 'v1',
    currentVersion: {
      id: 'v1',
      number: 3,
      sha256: 'a'.repeat(64),
      createdAt: new Date(),
      createdById: null,
      createdBy: null,
    },
    ...overrides,
  })
}

function delivery(
  recipientId: string,
  channel: DocumentDeliveryDTO['channel'],
): DocumentDeliveryDTO {
  return {
    recipientId,
    requested: channel,
    channel,
    delivered: true,
    message: null,
  }
}

beforeEach(() => {
  asRole('MEMBER')
  validate.mockImplementation((content) => ok(content as CanvasDocument))
  eventRepo.createMany.mockResolvedValue(ok(1))
  deliver.mockImplementation(async (_ctx, recipients) =>
    recipients.map((recipient) => ({
      recipient,
      delivery: delivery(recipient.id, recipient.channel),
    })),
  )
})

describe('DocumentSendService.send()', () => {
  it('freezes a version, delivers and returns the deliveries', async () => {
    const draft = createFakeDocumentFull({
      id: 'd1',
      workspaceId: 'ws1',
      content: pricedContent as never,
    })
    const recipient = createFakeDocumentRecipient({
      id: 'r1',
      channel: 'EMAIL',
    })
    documentRepo.findById
      .mockResolvedValueOnce(ok(draft))
      .mockResolvedValueOnce(ok(sentDocument({ recipients: [recipient] })))
    versionRepo.freeze.mockResolvedValue(
      ok({
        version: createFakeDocumentVersion({ id: 'v1', number: 1 }),
        recipients: [recipient],
      }),
    )

    const result = expectOk(
      await DocumentSendService.send('u1', 'ws1', 'd1', {
        recipients: [
          {
            name: 'Maria',
            email: 'Maria@Example.com',
            role: 'APPROVER',
            channel: 'EMAIL',
          },
        ],
        message: 'Segue a proposta',
      }),
    )

    const input = versionRepo.freeze.mock.calls[0][0]
    expect(input).toMatchObject({
      documentId: 'd1',
      workspaceId: 'ws1',
      actorId: 'u1',
      totalValue: 1200,
      validUntil: undefined,
    })
    expect(input.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(input.recipients[0]).toMatchObject({
      name: 'Maria',
      email: 'maria@example.com',
      phone: null,
      personId: null,
      role: 'APPROVER',
      channel: 'EMAIL',
    })
    expect(input.recipients[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const ctx = deliver.mock.calls[0][0]
    expect(ctx).toMatchObject({
      documentId: 'd1',
      documentTitle: draft.title,
      workspaceName: 'Stratus Lab',
      senderName: 'João Lima',
      senderEmail: 'joao@example.com',
      message: 'Segue a proposta',
    })
    expect(eventRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'SENT',
        recipientId: 'r1',
        actorId: 'u1',
        data: expect.objectContaining({ versionNumber: 1, channel: 'EMAIL' }),
      }),
    ])
    expect(result.deliveries).toEqual([delivery('r1', 'EMAIL')])
    expect(result.status).toBe('SENT')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send', targetId: 'd1' }),
    )
  })

  it('records one SENT event when there are no recipients', async () => {
    documentRepo.findById
      .mockResolvedValueOnce(ok(createFakeDocumentFull({ id: 'd1' })))
      .mockResolvedValueOnce(ok(sentDocument()))
    versionRepo.freeze.mockResolvedValue(
      ok({ version: createFakeDocumentVersion({ number: 2 }), recipients: [] }),
    )
    const validUntil = new Date(Date.now() + 5 * DAY_MS)
    expectOk(
      await DocumentSendService.send('u1', 'ws1', 'd1', {
        recipients: [],
        validUntil,
      }),
    )
    expect(versionRepo.freeze.mock.calls[0][0]).toMatchObject({
      validUntil,
      totalValue: 0,
    })
    expect(eventRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'SENT',
        data: { versionNumber: 2 },
      }),
    ])
  })

  it('refuses outsiders, VIEWERs and missing documents', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'FORBIDDEN',
    )
    asRole('VIEWER')
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('refuses templates, archived, invalid and empty documents', async () => {
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ isTemplate: true })),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ status: 'ARCHIVED' })),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    validate.mockReturnValueOnce(err('Versão do documento não suportada'))
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DOCUMENT_CONTENT_INVALID',
    )
    documentRepo.findById.mockResolvedValue(
      ok(
        createFakeDocumentFull({
          content: sampleDocumentContent({ empty: true }) as never,
        }),
      ),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DOCUMENT_EMPTY',
    )
    const noSection = sampleDocumentContent()
    noSection.nodes.root.children = []
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ content: noSection as never })),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DOCUMENT_EMPTY',
    )
    expect(versionRepo.freeze).not.toHaveBeenCalled()
  })

  it('refuses a validity in the past (stored or sent)', async () => {
    const past = new Date(Date.now() - 3 * DAY_MS)
    documentRepo.findById.mockResolvedValue(
      ok(createFakeDocumentFull({ validUntil: past })),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', {
        recipients: [],
        validUntil: past,
      }),
      'VALIDATION_ERROR',
    )
  })

  it('audits and propagates a failed freeze or reload', async () => {
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    versionRepo.freeze.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send', outcome: 'failure' }),
    )

    documentRepo.findById
      .mockResolvedValueOnce(ok(createFakeDocumentFull()))
      .mockResolvedValueOnce(err(databaseError()))
    versionRepo.freeze.mockResolvedValue(
      ok({ version: createFakeDocumentVersion(), recipients: [] }),
    )
    expectErr(
      await DocumentSendService.send('u1', 'ws1', 'd1', { recipients: [] }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentSendService recipients', () => {
  it('lists the recipients', async () => {
    documentRepo.findMeta.mockResolvedValue(
      ok({
        id: 'd1',
        workspaceId: 'ws1',
        status: 'SENT',
        isTemplate: false,
        updatedAt: new Date(),
        currentVersionId: 'v1',
      }),
    )
    recipientRepo.listByDocument.mockResolvedValue(
      ok([createFakeDocumentRecipient({ id: 'r1' })]),
    )
    const list = expectOk(
      await DocumentSendService.listRecipients('u1', 'ws1', 'd1'),
    )
    expect(list.map((recipient) => recipient.id)).toEqual(['r1'])

    recipientRepo.listByDocument.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentSendService.listRecipients('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
    documentRepo.findMeta.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentSendService.listRecipients('u1', 'ws1', 'd1'),
      'DOCUMENT_NOT_FOUND',
    )
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await DocumentSendService.listRecipients('u1', 'ws1', 'd1'),
      'FORBIDDEN',
    )
  })

  it('adds recipients to a sent document and delivers them', async () => {
    documentRepo.findById.mockResolvedValue(ok(sentDocument()))
    const created = createFakeDocumentRecipient({
      id: 'r2',
      channel: 'WHATSAPP',
      phone: '11988887777',
    })
    recipientRepo.createMany.mockResolvedValue(ok([created]))
    const added = expectOk(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients: [
          {
            name: 'Ana',
            phone: '11988887777',
            role: 'VIEWER',
            channel: 'WHATSAPP',
          },
        ],
      }),
    )
    expect(added[0]).toMatchObject({
      id: 'r2',
      delivery: delivery('r2', 'WHATSAPP'),
    })
    expect(recipientRepo.createMany.mock.calls[0][2][0]).toMatchObject({
      name: 'Ana',
      role: 'VIEWER',
      email: null,
    })
    expect(eventRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'SENT',
        recipientId: 'r2',
        data: expect.objectContaining({ versionNumber: 3 }),
      }),
    ])
  })

  it('refuses to add recipients before the first send', async () => {
    const recipients = [
      { name: 'Ana', role: 'APPROVER' as const, channel: 'LINK' as const },
    ]
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    expectErr(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients,
      }),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(
      ok(sentDocument({ status: 'ARCHIVED' })),
    )
    expectErr(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients,
      }),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(ok(sentDocument()))
    recipientRepo.createMany.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients,
      }),
      'DATABASE_ERROR',
    )
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients,
      }),
      'DOCUMENT_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await DocumentSendService.addRecipients('u1', 'ws1', 'd1', {
        recipients,
      }),
      'FORBIDDEN',
    )
  })

  it('removes a recipient of the document', async () => {
    documentRepo.findMeta.mockResolvedValue(
      ok({
        id: 'd1',
        workspaceId: 'ws1',
        status: 'SENT',
        isTemplate: false,
        updatedAt: new Date(),
        currentVersionId: 'v1',
      }),
    )
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1' })),
    )
    recipientRepo.delete.mockResolvedValue(ok(undefined))
    expectOk(await DocumentSendService.removeRecipient('u1', 'ws1', 'd1', 'r1'))
    expect(recipientRepo.findById).toHaveBeenCalledWith('r1', 'd1')
    expect(recipientRepo.delete).toHaveBeenCalledWith('r1')

    recipientRepo.delete.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentSendService.removeRecipient('u1', 'ws1', 'd1', 'r1'),
      'DATABASE_ERROR',
    )
    recipientRepo.findById.mockResolvedValue(err(documentRecipientNotFound()))
    expectErr(
      await DocumentSendService.removeRecipient('u1', 'ws1', 'd1', 'r9'),
      'DOCUMENT_RECIPIENT_NOT_FOUND',
    )
    documentRepo.findMeta.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentSendService.removeRecipient('u1', 'ws1', 'd1', 'r1'),
      'DOCUMENT_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await DocumentSendService.removeRecipient('u1', 'ws1', 'd1', 'r1'),
      'FORBIDDEN',
    )
  })

  it('resends the current version to one recipient', async () => {
    documentRepo.findById.mockResolvedValue(ok(sentDocument()))
    recipientRepo.findById.mockResolvedValue(
      ok(createFakeDocumentRecipient({ id: 'r1', channel: 'EMAIL' })),
    )
    const resent = expectOk(
      await DocumentSendService.resendRecipient('u1', 'ws1', 'd1', 'r1'),
    )
    expect(resent.delivery).toEqual(delivery('r1', 'EMAIL'))
    expect(eventRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({ resend: true, versionNumber: 3 }),
      }),
    ])
  })

  it('refuses to resend before the first send or to an unknown recipient', async () => {
    documentRepo.findById.mockResolvedValue(ok(createFakeDocumentFull()))
    expectErr(
      await DocumentSendService.resendRecipient('u1', 'ws1', 'd1', 'r1'),
      'VALIDATION_ERROR',
    )
    documentRepo.findById.mockResolvedValue(ok(sentDocument()))
    recipientRepo.findById.mockResolvedValue(err(documentRecipientNotFound()))
    expectErr(
      await DocumentSendService.resendRecipient('u1', 'ws1', 'd1', 'r9'),
      'DOCUMENT_RECIPIENT_NOT_FOUND',
    )
    documentRepo.findById.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentSendService.resendRecipient('u1', 'ws1', 'd1', 'r1'),
      'DOCUMENT_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await DocumentSendService.resendRecipient('u1', 'ws1', 'd1', 'r1'),
      'FORBIDDEN',
    )
  })
})
