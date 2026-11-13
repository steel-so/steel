import {
  decodePageCursor,
  pageResultToV1,
} from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { ListV1CrmDocumentsSchema } from '@/src/schemas/api-v1.schema'
import { CreateDocumentSchema } from '@/src/schemas/document.schema'
import { DocumentService } from '@/src/services/document.service'

/** CRM documents (proposals, contracts...); `isTemplate=true` lists the models. */
export const GET = apiV1Route({
  access: 'read',
  module: 'CRM',
  query: ListV1CrmDocumentsSchema,
  handler: async ({ session, query }) => {
    const page = decodePageCursor(query.cursor)
    if (!page.ok) return page
    const result = await DocumentService.list(
      session.userId,
      session.workspaceId,
      {
        kind: query.kind,
        status: query.status,
        q: query.q,
        ownerId: query.ownerId,
        companyId: query.companyId,
        personId: query.personId,
        opportunityId: query.opportunityId,
        leadId: query.leadId,
        isTemplate: query.isTemplate ?? false,
        page: page.value,
        pageSize: query.limit,
      },
    )
    if (!result.ok) return result
    return ok(pageResultToV1(result.value))
  },
})

/** Creates a draft (blank, from a template or a starter); emits `crm.document.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/documents',
  body: CreateDocumentSchema,
  status: 201,
  handler: ({ session, body }) =>
    DocumentService.create(session.userId, session.workspaceId, body),
})
