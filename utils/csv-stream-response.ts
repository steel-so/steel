/**
 * Streams a CSV built by an async generator (one chunk per database batch).
 * Errors before the first byte must be answered by the caller with the JSON
 * envelope; a failure mid-stream aborts the download.
 */
export function csvStreamResponse(
  chunks: AsyncGenerator<string>,
  filename: string,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await chunks.return(undefined)
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
