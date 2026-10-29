import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import {
  formatIssueDate,
  NewsletterArchiveShell,
} from '@/app/_components/crm/newsletters/archive/archive-shell'
import { NewsletterSubscribeForm } from '@/app/_components/crm/newsletters/archive/newsletter-subscribe-form'
import { Badge } from '@/components/ui/badge'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  newsletterArchiveUrl,
  newsletterRssUrl,
} from '@/src/lib/newsletter/urls'
import { NewsletterArchivePageSchema } from '@/src/schemas/crm-newsletter-archive.schema'
import { loadNewsletterArchive } from './_lib/load'

type Params = { workspaceSlug: string; newsletterSlug: string }
type SearchParams = Record<string, string | string[] | undefined>

function pageOf(searchParams: SearchParams): number {
  return NewsletterArchivePageSchema.parse(searchParams.pagina)
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  await connection()
  const { workspaceSlug, newsletterSlug } = await params
  const page = pageOf(await searchParams)
  const archive = await loadNewsletterArchive(
    workspaceSlug,
    newsletterSlug,
    page,
  )
  if (!archive) return { title: 'Newsletter não encontrada' }

  const { newsletter, workspaceName } = archive
  const title = `${newsletter.name} — ${workspaceName}`
  const description =
    newsletter.description?.slice(0, 200) ||
    `Todas as edições de ${newsletter.name}, de ${workspaceName}.`
  const url = newsletterArchiveUrl(
    BETTER_AUTH_URL,
    workspaceSlug,
    newsletterSlug,
  )
  const canonical = page > 1 ? `${url}?pagina=${page}` : url
  return {
    title,
    description,
    alternates: {
      canonical,
      types: {
        'application/rss+xml': [
          {
            url: newsletterRssUrl(
              BETTER_AUTH_URL,
              workspaceSlug,
              newsletterSlug,
            ),
            title: newsletter.name,
          },
        ],
      },
    },
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: workspaceName,
      url: canonical,
      title,
      description,
      ...(newsletter.logoUrl ? { images: [newsletter.logoUrl] } : {}),
    },
    twitter: {
      card: 'summary',
      title,
      description,
      ...(newsletter.logoUrl ? { images: [newsletter.logoUrl] } : {}),
    },
  }
}

/**
 * Public archive of a newsletter (`/n/<ws>/<newsletter>`, ADR 0054): name,
 * description, cadence, the subscribe form and the SENT issues, newest
 * first, 12 per page (`?pagina=`). 404 when the newsletter is missing or
 * archived, the archive is off or the workspace's CRM is off.
 */
export default async function NewsletterArchivePage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<SearchParams>
}) {
  await connection()
  const { workspaceSlug, newsletterSlug } = await params
  const page = pageOf(await searchParams)
  const archive = await loadNewsletterArchive(
    workspaceSlug,
    newsletterSlug,
    page,
  )
  if (!archive) notFound()

  const { newsletter, issues, pagination } = archive
  const base = `/n/${workspaceSlug}/${newsletterSlug}`
  const pageHref = (target: number) =>
    target > 1 ? `${base}?pagina=${target}` : base

  return (
    <NewsletterArchiveShell
      archive={archive}
      headingLevel='p'
      archiveHref={base}
      rssHref={`${base}/rss.xml`}
    >
      <section className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          {newsletter.cadenceLabel ? (
            <Badge variant='secondary'>{newsletter.cadenceLabel}</Badge>
          ) : null}
          <span className='text-muted-foreground text-xs'>
            {pagination.total === 1
              ? '1 edição publicada'
              : `${pagination.total} edições publicadas`}
          </span>
        </div>
        <h1 className='text-balance font-bold text-3xl tracking-tight sm:text-4xl'>
          {newsletter.name}
        </h1>
        {newsletter.description ? (
          <p className='whitespace-pre-line text-base text-muted-foreground leading-relaxed'>
            {newsletter.description}
          </p>
        ) : null}
      </section>

      <NewsletterSubscribeForm
        className='mt-8'
        workspaceSlug={workspaceSlug}
        newsletterSlug={newsletterSlug}
        newsletterName={newsletter.name}
        doubleOptIn={newsletter.doubleOptIn}
      />

      <section aria-labelledby='newsletter-issues' className='mt-12'>
        <h2
          id='newsletter-issues'
          className='mb-4 font-semibold text-lg tracking-tight'
        >
          Edições
        </h2>
        {issues.length === 0 ? (
          <div className='rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm'>
            {pagination.page > 1 ? (
              <>
                Esta página não tem edições.{' '}
                <Link
                  href={base}
                  className='text-primary underline-offset-4 hover:underline'
                >
                  Voltar para as mais recentes
                </Link>
              </>
            ) : (
              'A primeira edição ainda não saiu. Assine para receber assim que for publicada.'
            )}
          </div>
        ) : (
          <ol className='grid gap-3'>
            {issues.map((issue) => (
              <li key={issue.slug}>
                <Link
                  href={`${base}/${issue.slug}`}
                  className='group block rounded-xl border bg-card p-4 outline-none transition-colors hover:border-[var(--newsletter-brand,var(--primary))] focus-visible:ring-2 focus-visible:ring-ring sm:p-5'
                >
                  <p className='flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs'>
                    <span className='font-semibold text-[var(--newsletter-brand,var(--primary))]'>
                      #{issue.number}
                    </span>
                    <span aria-hidden='true'>·</span>
                    <time dateTime={issue.sentAt}>
                      {formatIssueDate(issue.sentAt)}
                    </time>
                  </p>
                  <h3 className='mt-1.5 text-pretty font-semibold text-base group-hover:underline group-hover:underline-offset-4 sm:text-lg'>
                    {issue.subject}
                  </h3>
                  {issue.excerpt ? (
                    <p className='mt-1.5 line-clamp-3 text-muted-foreground text-sm leading-relaxed'>
                      {issue.excerpt}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        )}

        {pagination.totalPages > 1 ? (
          <nav
            aria-label='Páginas de edições'
            className='mt-6 flex items-center justify-between gap-3 text-sm'
          >
            {pagination.page > 1 ? (
              <Link
                href={pageHref(pagination.page - 1)}
                rel='prev'
                className='rounded-md border px-3 py-2 hover:bg-muted'
              >
                Mais recentes
              </Link>
            ) : (
              <span />
            )}
            <span className='text-muted-foreground text-xs'>
              Página {Math.min(pagination.page, pagination.totalPages)} de{' '}
              {pagination.totalPages}
            </span>
            {pagination.page < pagination.totalPages ? (
              <Link
                href={pageHref(pagination.page + 1)}
                rel='next'
                className='rounded-md border px-3 py-2 hover:bg-muted'
              >
                Mais antigas
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </NewsletterArchiveShell>
  )
}
