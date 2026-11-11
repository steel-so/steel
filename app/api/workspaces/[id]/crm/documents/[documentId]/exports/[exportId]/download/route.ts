import type { NextRequest } from 'next/server'
import { logger } from '@/lib/axiom/logger'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { streamDocumentPdf } from '@/src/lib/document-export/stream'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentExportService } from '@/src/services/document-export.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; documentId: string; exportId: string }>
}

/**
 * Streams a READY export from MinIO (the storage API is never public, so
 * this is the `downloadUrl` of the export). Audited.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, documentId, exportId } = await ctx.params
  const target = await DocumentExportService.authorizeDownload(
    auth.value.user.id,
    id,
    documentId,
    exportId,
  )
  if (!target.ok) return handleError(target.error)

  try {
    return await streamDocumentPdf(target.value)
  } catch (error) {
    logger.error('document_export.download_failed', {
      component: 'DocumentExport',
      workspaceId: id,
      documentId,
      exportId,
      message: error instanceof Error ? error.message : String(error),
    })
    return standardError('STORAGE_ERROR', 'Arquivo do PDF indisponível')
  }
})
