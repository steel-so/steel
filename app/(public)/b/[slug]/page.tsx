import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { BioLinkView } from '@/app/_components/bio-link/bio-link-view'
import { BioViewBeacon } from '@/app/_components/bio-link/bio-view-beacon'
import { visibleBioBlocks } from '@/src/lib/bio-link/visibility'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { loadBioForms, loadPublishedBio } from '../_lib/load'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await loadPublishedBio(slug)
  if (!page) return { title: 'Link da bio', robots: NO_INDEX }
  return {
    title: page.title,
    description: page.description ?? undefined,
    robots: page.noIndex ? NO_INDEX : { index: true, follow: true },
    alternates: { canonical: `/b/${slug}` },
    openGraph: {
      type: 'profile',
      title: page.title,
      description: page.description ?? undefined,
      url: `/b/${slug}`,
      ...(page.avatarUrl ? { images: [page.avatarUrl] } : {}),
    },
  }
}

/**
 * Public "Link da bio" page (`/b/<slug>`): the page itself comes from the
 * cache (expired on every edit); which blocks show depends on the clock
 * (schedules), so the visibility filter runs per request. Unknown,
 * unpublished or CRM-disabled pages answer 404.
 */
export default async function BioLinkPage({ params }: Props) {
  await connection()
  const { slug } = await params
  const page = await loadPublishedBio(slug)
  if (!page) notFound()

  const blocks = visibleBioBlocks(page.blocks, new Date())
  const formTokens = blocks.flatMap((block) =>
    block.type === 'form' && block.mode === 'embed' ? [block.formToken] : [],
  )
  const forms =
    formTokens.length > 0 ? await loadBioForms(slug, formTokens) : {}

  return (
    <>
      <BioLinkView
        className='min-h-screen'
        title={page.title}
        description={page.description}
        avatarUrl={page.avatarUrl}
        theme={page.theme}
        blocks={blocks}
        forms={forms}
        linkHref={(block) => `/b/${slug}/l/${encodeURIComponent(block.id)}`}
      />
      <BioViewBeacon slug={slug} />
    </>
  )
}
