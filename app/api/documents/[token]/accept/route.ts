import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { guardDocumentPublicRequest } from '@/src/lib/documents/public-request'
import { AcceptDocumentSchema } from '@/src/schemas/document.schema'
import { DocumentPublicService } from '@/src/services/document-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** Accept (final): name, e-mail, fields, pricing selection and evidence. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardDocumentPublicRequest(request)
  if (!guard.ok) return handleError(guard.error)

  const [{ token }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = AcceptDocumentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await DocumentPublicService.accept(
    token,
    guard.value,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
