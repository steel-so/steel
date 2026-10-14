import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache } from 'react'
import { KbRichViewer } from '@/components/editor/kb-viewer'
import { WikiPublicService } from '@/src/services/wiki-public.service'

const loadPublishedPage = cache(async (token: string) => {
  const result = await WikiPublicService.getByToken(token)
  return result.ok ? result.value : null
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  await connection()
  const { token } = await params
  const page = await loadPublishedPage(token)
  return {
    title: page?.title.trim() || 'Página da Wiki',
    // A published page is reachable by whoever has the link, never by search.
    robots: { index: false, follow: false },
  }
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
})

/**
 * Published wiki page (`/w/<token>`): anonymous, read-only. An unknown or
 * revoked token, an archived page or a wiki switched off all 404.
 */
export default async function WikiPublicPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  const page = await loadPublishedPage(token)
  if (!page) notFound()

  return (
    <div className='flex min-h-screen flex-col bg-background'>
      {page.coverImage ? (
        <img
          src={page.coverImage}
          alt=''
          className='h-48 w-full object-cover sm:h-64'
        />
      ) : null}
      <main className='mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-8'>
        <header className='mb-6 space-y-2'>
          {page.icon ? (
            <span className='block text-5xl leading-none' aria-hidden>
              {page.icon}
            </span>
          ) : null}
          <h1 className='font-bold text-3xl text-foreground tracking-tight sm:text-4xl'>
            {page.title.trim() || 'Sem título'}
          </h1>
          <p className='text-muted-foreground text-sm'>
            Atualizado em {dateFormatter.format(new Date(page.updatedAt))}
          </p>
        </header>
        <KbRichViewer content={page.content} />
      </main>
      <footer className='border-border border-t px-4 py-6 text-center text-muted-foreground text-xs'>
        Publicado com Steel
      </footer>
    </div>
  )
}
