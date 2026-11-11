import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedDocument,
  seedDocumentRecipient,
  seedDocumentVersion,
} from '@/src/__tests__/factories/document-backend.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { DocumentEventRepository } from '../document-event.repository'
import { DocumentRecipientRepository } from '../document-recipient.repository'
import {
  type DocumentAnswerInput,
  DocumentResponseRepository,
} from '../document-response.repository'
import { DocumentVersionRepository } from '../document-version.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(overrides?: Parameters<typeof seedDocument>[2]) {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const doc = await seedDocument(workspace.id, user.id, overrides)
  return { workspace, user, doc }
}

function newRecipient(token: string) {
  return {
    name: 'Maria',
    email: 'maria@example.com',
    phone: null,
    personId: null,
    role: 'APPROVER' as const,
    channel: 'EMAIL' as const,
    token,
  }
}

describe('DocumentVersionRepository', () => {
  it('freezes sequential versions and moves the document to SENT', async () => {
    const { workspace, user, doc } = await setup({ status: 'EXPIRED' })
    const at = new Date('2026-11-11T12:00:00.000Z')
    const validUntil = new Date('2026-11-30T12:00:00.000Z')
    const base = {
      documentId: doc.id,
      workspaceId: workspace.id,
      actorId: user.id,
      content: { catalog: 'document' },
      theme: {},
      settings: { layout: 'web' },
      sha256: 'c'.repeat(64),
      totalValue: 1200,
      at,
    }

    const first = expectOk(
      await DocumentVersionRepository.freeze({
        ...base,
        validUntil,
        recipients: [newRecipient('tok-a')],
      }),
    )
    expect(first.version.number).toBe(1)
    expect(first.recipients.map((recipient) => recipient.token)).toEqual([
      'tok-a',
    ])

    let row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row).toMatchObject({
      status: 'SENT',
      currentVersionId: first.version.id,
      sentAt: at,
      validUntil,
      expiredAt: null,
    })
    expect(Number(row.totalValue)).toBe(1200)

    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'ACCEPTED', totalValue: 999 },
    })
    const second = expectOk(
      await DocumentVersionRepository.freeze({
        ...base,
        at: new Date(),
        recipients: [],
      }),
    )
    expect(second.version.number).toBe(2)
    expect(second.recipients).toEqual([])
    row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row.status).toBe('ACCEPTED')
    expect(Number(row.totalValue)).toBe(999)
    expect(row.sentAt).toEqual(at)
    expect(row.validUntil).toEqual(validUntil)

    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'DECLINED', declinedAt: new Date(), declineReason: 'x' },
    })
    expectOk(
      await DocumentVersionRepository.freeze({ ...base, recipients: [] }),
    )
    row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row).toMatchObject({
      status: 'SENT',
      declinedAt: null,
      declineReason: null,
    })

    const versions = expectOk(
      await DocumentVersionRepository.listByDocument(doc.id),
    )
    expect(versions.map((version) => version.number)).toEqual([3, 2, 1])
    expect(versions[0].createdBy).toEqual({ id: user.id, name: user.name })
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    vi.spyOn(prisma.documentVersion, 'findMany').mockRejectedValue(
      new Error('boom'),
    )
    expectErr(
      await DocumentVersionRepository.listByDocument('d'),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentVersionRepository.freeze({
        documentId: 'missing',
        workspaceId: 'ws',
        actorId: 'u',
        content: {},
        theme: {},
        settings: {},
        sha256: 'x',
        totalValue: 0,
        at: new Date(),
        recipients: [],
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentRecipientRepository', () => {
  it('creates, finds, marks and deletes recipients', async () => {
    const { workspace, doc } = await setup()
    const [created] = expectOk(
      await DocumentRecipientRepository.createMany(doc.id, workspace.id, [
        newRecipient('tok-1'),
      ]),
    )
    const byToken = await DocumentRecipientRepository.findByToken('tok-1')
    expect(expectOk(byToken)?.id).toBe(created.id)
    const unknown = await DocumentRecipientRepository.findByToken('nope')
    expect(expectOk(unknown)).toBeNull()
    expectOk(await DocumentRecipientRepository.findById(created.id, doc.id))
    expectErr(
      await DocumentRecipientRepository.findById(created.id, 'other-doc'),
      'DOCUMENT_RECIPIENT_NOT_FOUND',
    )

    const at = new Date('2026-11-11T12:00:00.000Z')
    const sent = expectOk(
      await DocumentRecipientRepository.markSent(created.id, {
        at,
        channel: 'LINK',
      }),
    )
    expect(sent).toMatchObject({ sentAt: at, channel: 'LINK' })

    expectOk(await DocumentRecipientRepository.markViewed(created.id, at))
    const later = new Date('2026-11-11T13:00:00.000Z')
    expectOk(await DocumentRecipientRepository.markViewed(created.id, later))
    const viewed = await prisma.documentRecipient.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(viewed).toMatchObject({
      status: 'VIEWED',
      firstViewedAt: at,
      lastViewedAt: later,
    })

    const list = expectOk(
      await DocumentRecipientRepository.listByDocument(doc.id),
    )
    expect(list).toHaveLength(1)
    expectOk(await DocumentRecipientRepository.delete(created.id))
    const empty = await DocumentRecipientRepository.listByDocument(doc.id)
    expect(expectOk(empty)).toEqual([])
  })

  it('finds a reader identified on the generic link only', async () => {
    const { workspace, doc } = await setup()
    await seedDocumentRecipient(doc.id, workspace.id, {
      email: 'owner-added@example.com',
      channel: 'LINK',
      sentAt: new Date(),
    })
    const identified = await seedDocumentRecipient(doc.id, workspace.id, {
      email: 'reader@example.com',
      channel: 'LINK',
    })
    const find = (email: string) =>
      DocumentRecipientRepository.findIdentified(doc.id, email)
    expect(expectOk(await find('READER@example.com'))?.id).toBe(identified.id)
    expect(expectOk(await find('owner-added@example.com'))).toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.documentRecipient, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.documentRecipient, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.documentRecipient, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.documentRecipient, 'createManyAndReturn').mockRejectedValue(
      boom,
    )
    vi.spyOn(prisma.documentRecipient, 'delete').mockRejectedValue(boom)
    vi.spyOn(prisma.documentRecipient, 'update').mockRejectedValue(boom)

    const repo = DocumentRecipientRepository
    expectErr(await repo.listByDocument('d'), 'DATABASE_ERROR')
    expectErr(await repo.findById('r', 'd'), 'DATABASE_ERROR')
    expectErr(await repo.findByToken('t'), 'DATABASE_ERROR')
    expectErr(await repo.findIdentified('d', 'a@b.co'), 'DATABASE_ERROR')
    expectErr(await repo.createMany('d', 'ws', []), 'DATABASE_ERROR')
    expectErr(await repo.delete('r'), 'DATABASE_ERROR')
    expectErr(
      await repo.markSent('r', { at: new Date(), channel: 'LINK' }),
      'DATABASE_ERROR',
    )

    vi.spyOn(prisma, '$transaction').mockRejectedValue(boom)
    expectErr(await repo.markViewed('r', new Date()), 'DATABASE_ERROR')
  })
})

describe('DocumentResponseRepository', () => {
  async function sentSetup() {
    const { workspace, user, doc } = await setup({ status: 'VIEWED' })
    const version = await seedDocumentVersion(doc.id, workspace.id)
    await prisma.document.update({
      where: { id: doc.id },
      data: { currentVersionId: version.id },
    })
    const recipient = await seedDocumentRecipient(doc.id, workspace.id)
    const answer = (
      overrides?: Partial<DocumentAnswerInput>,
    ): DocumentAnswerInput => ({
      documentId: doc.id,
      workspaceId: workspace.id,
      versionId: version.id,
      versionSha256: version.sha256,
      recipientId: recipient.id,
      action: 'ACCEPT',
      name: 'Maria',
      email: 'maria@example.com',
      fields: { f1: 'x' },
      selection: {},
      totalValue: 1500,
      reason: null,
      ipHash: 'hash',
      userAgent: 'UA',
      at: new Date('2026-11-11T12:00:00.000Z'),
      ...overrides,
    })
    return { workspace, user, doc, version, recipient, answer }
  }

  it('records an accept once, with the document and recipient status', async () => {
    const { doc, recipient, answer } = await sentSetup()

    const response = expectOk(await DocumentResponseRepository.answer(answer()))
    expect(response?.action).toBe('ACCEPT')
    const again = await DocumentResponseRepository.answer(answer())
    expect(expectOk(again)).toBeNull()

    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row).toMatchObject({
      status: 'ACCEPTED',
      acceptedByName: 'Maria',
      acceptedByEmail: 'maria@example.com',
    })
    expect(Number(row.totalValue)).toBe(1500)
    const updated = await prisma.documentRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    })
    expect(updated.status).toBe('ACCEPTED')

    const events = await prisma.documentEvent.findMany({
      where: { documentId: doc.id },
    })
    expect(events.map((event) => event.type)).toEqual(['ACCEPTED'])
    const list = expectOk(
      await DocumentResponseRepository.listByDocument(doc.id),
    )
    expect(list[0].version.number).toBe(1)
  })

  it('records a decline and refuses a stale version', async () => {
    const { doc, answer } = await sentSetup()
    const stale = await DocumentResponseRepository.answer(
      answer({ action: 'DECLINE', versionId: 'old', totalValue: null }),
    )
    expect(expectOk(stale)).toBeNull()
    expectOk(
      await DocumentResponseRepository.answer(
        answer({ action: 'DECLINE', reason: 'Caro', totalValue: null }),
      ),
    )
    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row).toMatchObject({ status: 'DECLINED', declineReason: 'Caro' })
  })

  it('records field submissions without touching the status', async () => {
    const { doc, recipient, answer } = await sentSetup()
    expectOk(
      await DocumentResponseRepository.answer(
        answer({ action: 'SUBMIT', recipientId: null }),
      ),
    )
    const submitted = () =>
      DocumentResponseRepository.hasAnswer(doc.id, recipient.id, 'SUBMIT')
    expect(expectOk(await submitted())).toBe(false)
    expectOk(
      await DocumentResponseRepository.answer(answer({ action: 'SUBMIT' })),
    )
    expect(expectOk(await submitted())).toBe(true)
    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row.status).toBe('VIEWED')
    const updated = await prisma.documentRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    })
    expect(updated.status).toBe('PENDING')
    expect(updated.respondedAt).not.toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.documentResponse, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.documentResponse, 'count').mockRejectedValue(boom)
    vi.spyOn(prisma, '$transaction').mockRejectedValue(boom)
    const repo = DocumentResponseRepository
    expectErr(await repo.listByDocument('d'), 'DATABASE_ERROR')
    expectErr(await repo.hasAnswer('d', 'r', 'SUBMIT'), 'DATABASE_ERROR')
    expectErr(
      await repo.answer({
        documentId: 'd',
        workspaceId: 'ws',
        versionId: 'v',
        versionSha256: 's',
        recipientId: null,
        action: 'SUBMIT',
        name: null,
        email: null,
        fields: {},
        selection: {},
        totalValue: null,
        reason: null,
        ipHash: 'h',
        userAgent: null,
        at: new Date(),
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentEventRepository', () => {
  it('creates events and lists them with recipient and actor names', async () => {
    const { workspace, user, doc } = await setup()
    const recipient = await seedDocumentRecipient(doc.id, workspace.id, {
      name: 'Maria',
    })
    expect(expectOk(await DocumentEventRepository.createMany([]))).toBe(0)
    expect(
      expectOk(
        await DocumentEventRepository.createMany([
          {
            documentId: doc.id,
            workspaceId: workspace.id,
            type: 'CREATED',
            actorId: user.id,
          },
          {
            documentId: doc.id,
            workspaceId: workspace.id,
            type: 'SENT',
            recipientId: recipient.id,
            data: { channel: 'EMAIL' },
          },
        ]),
      ),
    ).toBe(2)

    const events = expectOk(
      await DocumentEventRepository.listByDocument(doc.id),
    )
    const sent = events.find((event) => event.type === 'SENT')
    const created = events.find((event) => event.type === 'CREATED')
    expect(sent?.recipient).toEqual({ id: recipient.id, name: 'Maria' })
    expect(sent?.data).toEqual({ channel: 'EMAIL' })
    expect(created?.actor).toEqual({ id: user.id, name: user.name })
    expect(created?.data).toEqual({})
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.documentEvent, 'createMany').mockRejectedValue(boom)
    vi.spyOn(prisma.documentEvent, 'findMany').mockRejectedValue(boom)
    expectErr(
      await DocumentEventRepository.createMany([
        { documentId: 'd', workspaceId: 'ws', type: 'CREATED' },
      ]),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentEventRepository.listByDocument('d'),
      'DATABASE_ERROR',
    )
  })
})
