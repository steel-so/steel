import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { SitePublicService } from '@/src/services/site-public.service'

type PageProps = { params: Promise<{ shareToken: string }> }

export const metadata: Metadata = {
  title: 'Página indisponível',
  robots: NO_INDEX,
}

/**
 * Address of the removed landing page editor (ADR 0068). Landing pages that
 * were migrated to Sites keep the link: it follows the published site that
 * carries the old share token. Anything else is gone.
 */
export default async function LegacyLandingPageAddress({ params }: PageProps) {
  // Depends on live state (a site can be unpublished) — never prerender.
  await connection()

  const { shareToken } = await params
  const target = await SitePublicService.landingRedirect(shareToken)
  if (target.ok && target.value) redirect(target.value)

  return (
    <main className='flex min-h-svh flex-col items-center justify-center gap-2 px-6 text-center'>
      <h1 className='font-semibold text-lg'>Página indisponível</h1>
      <p className='max-w-md text-muted-foreground text-sm'>
        Este link pode ter sido despublicado ou não existe mais.
      </p>
    </main>
  )
}
