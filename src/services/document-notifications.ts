import { emitNotification } from './notification-emitter'

/**
 * In-app notifications of CRM > Documentos (ADR 0063), fire-and-forget like
 * `crm-notifications.ts`. The owner of the document is the recipient.
 */

type DocumentRef = { id: string; title: string; ownerId: string }

export const documentPath = (id: string) => `/crm/documents/${id}`

export function notifyDocumentAnswered(input: {
  workspaceId: string
  document: DocumentRef
  action: 'ACCEPT' | 'DECLINE'
  readerName: string
}): Promise<number> {
  const accepted = input.action === 'ACCEPT'
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.document.ownerId],
    kind: accepted ? 'CRM_DOCUMENT_ACCEPTED' : 'CRM_DOCUMENT_DECLINED',
    title: accepted
      ? `Documento aceito: ${input.document.title}`
      : `Documento recusado: ${input.document.title}`,
    body: accepted
      ? `${input.readerName} aceitou o documento.`
      : `${input.readerName} recusou o documento.`,
    path: documentPath(input.document.id),
    dedupeKey: `crm-document-${accepted ? 'accepted' : 'declined'}:${input.document.id}`,
  })
}

export function notifyDocumentExpired(input: {
  workspaceId: string
  document: DocumentRef
  expiredAt: Date
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.document.ownerId],
    kind: 'CRM_DOCUMENT_EXPIRED',
    title: `Documento expirado: ${input.document.title}`,
    body: 'A validade terminou sem resposta.',
    path: documentPath(input.document.id),
    dedupeKey: `crm-document-expired:${input.document.id}:${input.expiredAt.toISOString()}`,
  })
}
