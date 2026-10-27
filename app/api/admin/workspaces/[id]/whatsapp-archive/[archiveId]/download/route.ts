import type { NextRequest } from 'next/server'
import { logger } from '@/lib/axiom/logger'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getObjectStream } from '@/src/lib/storage/s3'
import { WhatsAppArchiveService } from '@/src/services/whatsapp-archive.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; archiveId: string }> }

/**
 * Platform admin download of a package (to hand it to a bank); audited in
 * the admin trail.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, archiveId } = await ctx.params
  const target = await WhatsAppArchiveService.adminAuthorizeDownload(
    auth.value.user.id,
    id,
    archiveId,
  )
  if (!target.ok) return handleError(target.error)

  try {
    const object = await getObjectStream(target.value)
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${target.value.fileName}"`,
        'Cache-Control': 'no-store',
        ...(object.contentLength !== undefined && {
          'Content-Length': String(object.contentLength),
        }),
      },
    })
  } catch (error) {
    logger.error('whatsapp_archive.download_failed', {
      component: 'WhatsAppArchive',
      workspaceId: id,
      archiveId,
      message: error instanceof Error ? error.message : String(error),
    })
    return standardError('STORAGE_ERROR', 'Arquivo do pacote indisponível')
  }
})
