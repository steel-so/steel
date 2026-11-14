import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateDocumentSchema } from '@/src/schemas/document.schema'
import { DocumentService } from '@/src/services/document.service'

export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  handler: ({ session, params }) =>
    DocumentService.get(session.userId, session.workspaceId, params.documentId),
})

/** Data, links, validity, status (`ARCHIVED`/`DRAFT`); emits `crm.document.updated`. */
export const PATCH = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'PATCH /api/v1/crm/documents/[documentId]',
  body: UpdateDocumentSchema,
  handler: ({ session, params, body }) =>
    DocumentService.update(
      session.userId,
      session.workspaceId,
      params.documentId,
      body,
    ),
})

export const DELETE = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'DELETE /api/v1/crm/documents/[documentId]',
  handler: async ({ session, params }) => {
    const result = await DocumentService.remove(
      session.userId,
      session.workspaceId,
      params.documentId,
    )
    if (!result.ok) return result
    return ok({ id: params.documentId })
  },
})
