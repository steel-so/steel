import { describe, expect, it } from 'vitest'
import {
  createFakeDocumentFull,
  createFakeDocumentRecipient,
  createFakeDocumentVersion,
  createFakePublicContext,
  decimal,
} from '@/src/__tests__/factories/document-backend.factory'
import { documentVersionHash } from '@/src/lib/documents/hash'
import { parseDocumentSettings } from '@/src/lib/documents/settings'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import {
  documentLinkUrl,
  jsonRecord,
  publicDocumentStatus,
  toDocumentDTO,
  toDocumentEventDTO,
  toDocumentListItemDTO,
  toDocumentPublicDTO,
  toDocumentResponseDTO,
} from '../document.mapper'

const DAY_MS = 86_400_000

describe('document mapper', () => {
  it('builds absolute links and plain JSON records', () => {
    expect(documentLinkUrl('abc')).toMatch(/^https?:\/\/.+\/d\/abc$/)
    expect(jsonRecord({ a: 1 })).toEqual({ a: 1 })
    expect(jsonRecord([1])).toEqual({})
    expect(jsonRecord(null)).toEqual({})
    expect(jsonRecord('x')).toEqual({})
  })

  it('maps a list row with money, dates and the view count', () => {
    const sentAt = new Date('2026-11-10T12:00:00.000Z')
    const row = createFakeDocumentFull({
      totalValue: decimal(1234.5),
      sentAt,
      company: { id: 'c1', name: 'Cliente' },
      _count: { sessions: 3 },
    })
    const dto = toDocumentListItemDTO(row)
    expect(dto.totalValue).toBe(1234.5)
    expect(dto.sentAt).toBe(sentAt.toISOString())
    expect(dto.validUntil).toBeNull()
    expect(dto.viewCount).toBe(3)
    expect(dto.company).toEqual({ id: 'c1', name: 'Cliente' })
    expect(dto.owner).toEqual({
      id: row.ownerId,
      name: 'João Lima',
      image: null,
    })
  })

  it('maps the full document with recipients and no unsent changes', () => {
    const row = createFakeDocumentFull()
    const settings = parseDocumentSettings(row.settings)
    const sha256 = documentVersionHash({
      content: row.content,
      theme: row.theme,
      settings,
    })
    const recipient = createFakeDocumentRecipient({
      sentAt: new Date(),
      token: 'tok-1',
    })
    const dto = toDocumentDTO({
      ...row,
      recipients: [recipient],
      currentVersion: {
        id: 'v1',
        number: 2,
        sha256,
        createdAt: new Date(),
        createdById: 'u1',
        createdBy: { id: 'u1', name: 'João' },
      },
    })
    expect(dto.hasUnsentChanges).toBe(false)
    expect(dto.currentVersion?.number).toBe(2)
    expect(dto.currentVersion?.createdBy).toEqual({ id: 'u1', name: 'João' })
    expect(dto.settings).toEqual(DEFAULT_DOCUMENT_SETTINGS)
    expect(dto.publicUrl).toMatch(/\/d\//)
    expect(dto.recipients[0].url).toMatch(/\/d\/tok-1$/)
    expect(dto.recipients[0].sentAt).not.toBeNull()
  })

  it('flags unsent changes when the draft differs from the version', () => {
    const dto = toDocumentDTO(
      createFakeDocumentFull({
        currentVersion: {
          id: 'v1',
          number: 1,
          sha256: 'f'.repeat(64),
          createdAt: new Date(),
          createdById: null,
          createdBy: null,
        },
      }),
    )
    expect(dto.hasUnsentChanges).toBe(true)
    expect(toDocumentDTO(createFakeDocumentFull()).hasUnsentChanges).toBe(false)
  })

  it('maps events and responses', () => {
    const now = new Date()
    expect(
      toDocumentEventDTO({
        id: 'e1',
        documentId: 'd1',
        workspaceId: 'w1',
        type: 'SENT',
        sessionId: null,
        recipientId: 'r1',
        actorId: 'u1',
        data: { channel: 'EMAIL' },
        createdAt: now,
        recipient: { id: 'r1', name: 'Maria' },
        actor: { id: 'u1', name: 'João' },
      }),
    ).toEqual({
      id: 'e1',
      type: 'SENT',
      recipient: { id: 'r1', name: 'Maria' },
      actor: { id: 'u1', name: 'João' },
      data: { channel: 'EMAIL' },
      createdAt: now.toISOString(),
    })

    const response = toDocumentResponseDTO({
      id: 'resp1',
      documentId: 'd1',
      workspaceId: 'w1',
      versionId: 'v1',
      recipientId: null,
      action: 'ACCEPT',
      name: 'Maria',
      email: 'maria@example.com',
      fields: { f1: 'x' },
      selection: { extra: { selected: true, quantity: 1 } },
      totalValue: decimal(1500),
      reason: null,
      versionSha256: 'a'.repeat(64),
      ipHash: 'h',
      userAgent: null,
      createdAt: now,
      version: { number: 3 },
    })
    expect(response.versionNumber).toBe(3)
    expect(response.totalValue).toBe(1500)
    expect(response.selection).toEqual({
      extra: { selected: true, quantity: 1 },
    })
    const declined = toDocumentResponseDTO({
      id: 'resp2',
      documentId: 'd1',
      workspaceId: 'w1',
      versionId: 'v1',
      recipientId: 'r1',
      action: 'DECLINE',
      name: null,
      email: null,
      fields: [],
      selection: {},
      totalValue: null,
      reason: 'Caro',
      versionSha256: 'a',
      ipHash: 'h',
      userAgent: 'UA',
      createdAt: now,
      version: { number: 1 },
    })
    expect(declined.fields).toEqual({})
    expect(declined.totalValue).toBeNull()
  })

  it('computes the public status from the validity', () => {
    const past = new Date(Date.now() - 3 * DAY_MS)
    const future = new Date(Date.now() + 3 * DAY_MS)
    expect(publicDocumentStatus({ status: 'SENT', validUntil: past })).toBe(
      'EXPIRED',
    )
    expect(publicDocumentStatus({ status: 'VIEWED', validUntil: past })).toBe(
      'EXPIRED',
    )
    expect(publicDocumentStatus({ status: 'SENT', validUntil: future })).toBe(
      'SENT',
    )
    expect(publicDocumentStatus({ status: 'ACCEPTED', validUntil: past })).toBe(
      'ACCEPTED',
    )
  })

  it('maps the public link from the frozen version', () => {
    const context = createFakePublicContext(
      { title: 'Contrato' },
      createFakeDocumentVersion({
        number: 4,
        settings: { allowDownload: false },
        theme: { primaryColor: '#000000' },
      }),
    )
    const generic = toDocumentPublicDTO({
      token: 'tok',
      context,
      recipient: null,
      variables: { 'contato.nome': 'Maria' },
    })
    expect(generic.version.number).toBe(4)
    expect(generic.document.title).toBe('Contrato')
    expect(generic.document.settings.allowDownload).toBe(false)
    expect(generic.document.theme).toEqual({ primaryColor: '#000000' })
    expect(generic.canAccept).toBe(true)
    expect(generic.canDownload).toBe(false)
    expect(generic.paymentEnabled).toBe(false)
    expect(generic.recipient).toBeNull()
    expect(generic.brand).toEqual({ name: 'Stratus Lab', logoUrl: null })

    const viewer = toDocumentPublicDTO({
      token: 'tok',
      context,
      recipient: createFakeDocumentRecipient({ id: 'r1', role: 'VIEWER' }),
      variables: {},
    })
    expect(viewer.canAccept).toBe(false)
    expect(viewer.recipient).toMatchObject({ id: 'r1', role: 'VIEWER' })
  })
})
