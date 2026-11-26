import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CreateWhatsAppAiMediaSchema } from '@/src/schemas/whatsapp-ai-media.schema'
import { WhatsAppAiMediaService } from '@/src/services/whatsapp-ai-media.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 16 * 1024 * 1024

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const result = await WhatsAppAiMediaService.list(auth.value.user.id, id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/whatsapp/ai-config/media',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params

  const form = await request.formData().catch(() => null)
  if (!form) return standardError('VALIDATION_ERROR', 'Formulário inválido')
  const file = form.get('file')
  if (!(file instanceof File)) {
    return standardError('VALIDATION_ERROR', 'Arquivo não enviado')
  }
  if (file.size > MAX_BYTES) {
    return standardError(
      'VALIDATION_ERROR',
      'Arquivo muito grande. Máximo 16 MB',
    )
  }
  const parsed = CreateWhatsAppAiMediaSchema.safeParse({
    name: form.get('name')?.toString() ?? '',
    whenToSend: form.get('whenToSend')?.toString() ?? '',
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppAiMediaService.create(auth.value.user.id, id, {
    ...parsed.data,
    contentType: file.type,
    fileName: file.name,
    byteSize: file.size,
    readBody: async () => Buffer.from(await file.arrayBuffer()),
  })
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value, 201)
})
