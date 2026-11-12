import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { cache } from 'react'
import { DocumentViewer } from '@/app/_components/documents/public/document-viewer'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { DocumentPublicService } from '@/src/services/document-public.service'

type PageProps = { params: Promise<{ token: string }> }

/**
 * One load per request, shared by the metadata and the page. It marks the
 * first/last read; link previews (WhatsApp, Slack...) are skipped by user
 * agent in the service.
 */
const loadDocument = cache(async (token: string) => {
  const userAgent = (await headers()).get('user-agent')
  return DocumentPublicService.getByToken(token, {
    recordView: true,
    userAgent,
  })
})

/**
 * Documents are designed on light paper: opt out of the browsers' forced
 * dark mode (Chrome/Samsung on Android), which inverted covers and revealed
 * text meant to sit on a background image.
 */
export const viewport: Viewport = { colorScheme: 'only light' }

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  await connection()
  const { token } = await params
  const result = await loadDocument(token)
  return {
    title: result.ok ? result.value.document.title : 'Documento',
    // Reachable by whoever has the link, never by search engines.
    robots: NO_INDEX,
  }
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <main className='flex min-h-svh flex-col items-center justify-center gap-2 bg-background px-6 text-center'>
      <h1 className='font-semibold text-foreground text-lg'>{title}</h1>
      <p className='max-w-md text-muted-foreground text-sm'>{body}</p>
    </main>
  )
}

/**
 * Public link of a document (`/d/<token>`, ADR 0063): the version sent to
 * the reader, rendered by the documents viewer. An expired document stays
 * readable (the viewer says it can no longer be accepted).
 */
export default async function PublicDocumentPage({ params }: PageProps) {
  // Live state (status, answers): never prerender.
  await connection()
  const { token } = await params
  const result = await loadDocument(token)

  if (!result.ok) {
    if (result.error.code === 'DOCUMENT_LINK_UNAVAILABLE') {
      return (
        <Unavailable
          title='Documento indisponível'
          body='Este link não existe mais ou ainda não foi liberado. Peça um novo link a quem enviou o documento.'
        />
      )
    }
    return (
      <Unavailable
        title='Não foi possível abrir o documento'
        body='Algo deu errado do nosso lado. Tente de novo em alguns instantes.'
      />
    )
  }

  // The viewer renders the expired, accepted and declined banners itself.
  return <DocumentViewer data={result.value} />
}
