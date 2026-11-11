import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
}))

import {
  documentPath,
  notifyDocumentAnswered,
  notifyDocumentExpired,
} from '../document-notifications'
import { emitNotification } from '../notification-emitter'

const emit = vi.mocked(emitNotification)
const DOC = { id: 'd1', title: 'Proposta', ownerId: 'owner' }

describe('document notifications', () => {
  it('notifies the owner of an accept and a decline', async () => {
    await notifyDocumentAnswered({
      workspaceId: 'ws1',
      document: DOC,
      action: 'ACCEPT',
      readerName: 'Maria',
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipients: ['owner'],
        kind: 'CRM_DOCUMENT_ACCEPTED',
        title: 'Documento aceito: Proposta',
        body: 'Maria aceitou o documento.',
        path: '/crm/documents/d1',
        dedupeKey: 'crm-document-accepted:d1',
      }),
    )

    await notifyDocumentAnswered({
      workspaceId: 'ws1',
      document: DOC,
      action: 'DECLINE',
      readerName: 'Carlos',
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'CRM_DOCUMENT_DECLINED',
        title: 'Documento recusado: Proposta',
        body: 'Carlos recusou o documento.',
      }),
    )
  })

  it('notifies the owner of an expiry once per expiry', async () => {
    const expiredAt = new Date('2026-11-12T03:10:00.000Z')
    await notifyDocumentExpired({
      workspaceId: 'ws1',
      document: DOC,
      expiredAt,
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'CRM_DOCUMENT_EXPIRED',
        dedupeKey: `crm-document-expired:d1:${expiredAt.toISOString()}`,
      }),
    )
    expect(documentPath('x')).toBe('/crm/documents/x')
  })
})
