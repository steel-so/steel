import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ExportWhatsAppConversationSchema } from '@/src/schemas/whatsapp-conversation.schema'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; conversationId: string }> }

/** Downloads the conversation transcript: TXT (default) or CSV (?format=csv). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, conversationId } = await ctx.params
  const parsed = ExportWhatsAppConversationSchema.safeParse({
    format: request.nextUrl.searchParams.get('format') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppConversationService.exportTranscript(
    auth.value.user.id,
    id,
    conversationId,
    parsed.data.format,
  )
  if (!result.ok) return handleError(result.error)

  return new Response(result.value.body, {
    status: 200,
    headers: {
      'Content-Type': result.value.contentType,
      'Content-Disposition': `attachment; filename="${result.value.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
})
