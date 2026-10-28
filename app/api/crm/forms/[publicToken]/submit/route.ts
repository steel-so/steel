import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SubmitCrmFormSchema } from '@/src/schemas/crm-form.schema'
import { CrmFormService } from '@/src/services/crm-form.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ publicToken: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'

  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { publicToken } = await ctx.params
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const body = json.value
  const parsed = SubmitCrmFormSchema.safeParse(body)

  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmFormService.submit(
    publicToken,
    ip,
    request.headers.get('referer') ?? undefined,
    parsed.data,
    request.headers.get('user-agent'),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
