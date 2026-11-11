import { getObjectStream } from '@/src/lib/storage/s3'
import { type DocumentExportFile, PDF_CONTENT_TYPE } from './storage'

/** A PDF export streamed from MinIO as an attachment download. */
export async function streamDocumentPdf(
  file: DocumentExportFile,
): Promise<Response> {
  const object = await getObjectStream({ bucket: file.bucket, key: file.key })
  return new Response(object.body, {
    headers: {
      'Content-Type': PDF_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(object.contentLength !== undefined && {
        'Content-Length': String(object.contentLength),
      }),
    },
  })
}
