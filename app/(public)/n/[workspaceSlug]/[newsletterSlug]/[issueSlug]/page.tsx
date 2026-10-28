import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import {
  formatIssueDate,
  NewsletterArchiveShell,
} from '@/app/_components/crm/newsletters/archive/archive-shell'
import { NewsletterIssueFrame } from '@/app/_components/crm/newsletters/archive/newsletter-issue-frame'
import { NewsletterSubscribeForm } from '@/app/_components/crm/newsletters/archive/newsletter-subscribe-form'
import { SteelIcon } from '@/components/icon/icon'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { newsletterIssueUrl, newsletterRssUrl } from '@/src/lib/newsletter/urls'
import { issueFrameDocument } from '@/src/lib/newsletter/web-html'
import { loadNewsletterIssue } from '../_lib/load'

type Params = {
  workspaceSlug: string
  newsletterSlug: string
  issueSlug: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  await connection()
  const { workspaceSlug, newsletterSlug, issueSlug } = await params
  const data = await loadNewsletterIssue(
    workspaceSlug,
    newsletterSlug,
    issueSlug,
  )
  if (!data) return { title: 'Edição não encontrada' }

  const { issue, newsletter, workspaceName } = data
  const title = `${issue.subject} — ${newsletter.name}`
  const description = (
    issue.preheader ||
    issue.excerpt ||
    `Edição #${issue.number} de ${newsletter.name}, de ${workspaceName}.`
  ).slice(0, 200)
  const url = newsletterIssueUrl(
    BETTER_AUTH_URL,
    workspaceSlug,
    newsletterSlug,
    issueSlug,
  )
  return {
    title,
    description,
    alternates: {
      canonical: url,
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
      type: 'article',
      locale: 'pt_BR',
      siteName: newsletter.name,
      url,
      title: issue.subject,
      description,
      publishedTime: issue.sentAt,
      ...(newsletter.logoUrl ? { images: [newsletter.logoUrl] } : {}),
    },
    twitter: {
      card: 'summary',
      title: issue.subject,
      description,
      ...(newsletter.logoUrl ? { images: [newsletter.logoUrl] } : {}),
    },
  }
}

/**
 * Web version of a SENT issue (`/n/<ws>/<newsletter>/<issue>`): the archive
 * header, the issue's web HTML in a sandboxed frame, links to the previous
 * and next issues and the subscribe form at the end.
 */
export default async function NewsletterIssuePage({
  params,
}: {
  params: Promise<Params>
}) {
  await connection()
  const { workspaceSlug, newsletterSlug, issueSlug } = await params
  const data = await loadNewsletterIssue(
    workspaceSlug,
    newsletterSlug,
    issueSlug,
  )
  if (!data) notFound()

  const { issue, newsletter, previous, next } = data
  const base = `/n/${workspaceSlug}/${newsletterSlug}`

  return (
    <NewsletterArchiveShell
      archive={data}
      headingLevel='p'
      archiveHref={base}
      rssHref={`${base}/rss.xml`}
    >
      <article>
        <header className='mb-6 space-y-2'>
          <p className='flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm'>
            <Link
              href={base}
              className='font-medium hover:text-foreground hover:underline hover:underline-offset-4'
            >
              Todas as edições
            </Link>
            <span aria-hidden='true'>·</span>
            <span className='font-semibold text-[var(--newsletter-brand,var(--primary))]'>
              #{issue.number}
            </span>
            <span aria-hidden='true'>·</span>
            <time dateTime={issue.sentAt}>{formatIssueDate(issue.sentAt)}</time>
          </p>
          <h1 className='text-balance font-bold text-2xl tracking-tight sm:text-3xl'>
            {issue.subject}
          </h1>
          {issue.preheader ? (
            <p className='text-muted-foreground'>{issue.preheader}</p>
          ) : null}
        </header>
        <NewsletterIssueFrame
          title={`Edição #${issue.number}: ${issue.subject}`}
          srcDoc={issueFrameDocument(issue.webHtml)}
        />
      </article>

      {previous || next ? (
        <nav
          aria-label='Outras edições'
          className='mt-8 grid gap-3 sm:grid-cols-2'
        >
          {previous ? (
            <Link
              href={`${base}/${previous.slug}`}
              rel='prev'
              className='flex flex-col gap-1 rounded-xl border bg-card p-4 hover:bg-muted'
            >
              <span className='inline-flex items-center gap-1 text-muted-foreground text-xs'>
                <SteelIcon icon={ArrowLeft01Icon} size={14} />
                Anterior · #{previous.number}
              </span>
              <span className='line-clamp-2 font-medium text-sm'>
                {previous.subject}
              </span>
            </Link>
          ) : (
            <span className='hidden sm:block' />
          )}
          {next ? (
            <Link
              href={`${base}/${next.slug}`}
              rel='next'
              className='flex flex-col items-end gap-1 rounded-xl border bg-card p-4 text-right hover:bg-muted'
            >
              <span className='inline-flex items-center gap-1 text-muted-foreground text-xs'>
                Próxima · #{next.number}
                <SteelIcon icon={ArrowRight01Icon} size={14} />
              </span>
              <span className='line-clamp-2 font-medium text-sm'>
                {next.subject}
              </span>
            </Link>
          ) : null}
        </nav>
      ) : null}

      <NewsletterSubscribeForm
        className='mt-10'
        workspaceSlug={workspaceSlug}
        newsletterSlug={newsletterSlug}
        newsletterName={newsletter.name}
        doubleOptIn={newsletter.doubleOptIn}
        title={`Gostou? Assine ${newsletter.name}`}
        description={
          newsletter.cadenceLabel
            ? `Frequência: ${newsletter.cadenceLabel.toLowerCase()}. Cancele quando quiser.`
            : 'Receba as próximas edições no seu e-mail. Cancele quando quiser.'
        }
      />
    </NewsletterArchiveShell>
  )
}
