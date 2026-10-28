'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrmEmailBrand } from '@/src/hooks/use-crm-email-builder'
import { useCrmNewsletterIssue } from '@/src/hooks/use-crm-newsletter-issues'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { issueReportHref, newsletterHref } from '../issue-format'
import { NewsletterIssueCanvasEditor } from './newsletter-issue-canvas-editor'

function Message({
  children,
  href,
  label,
}: {
  children: string
  href: string
  label: string
}) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
      <p className='max-w-md text-muted-foreground text-sm'>{children}</p>
      <Link href={href} className={buttonVariants({ variant: 'outline' })}>
        {label}
      </Link>
    </div>
  )
}

/**
 * Loader of the issue editor: the issue (with its document) and the
 * workspace e-mail brand. Issues that left DRAFT/SCHEDULED are read-only:
 * the page points to the report instead.
 */
export function NewsletterIssueEditorPage({
  workspaceId,
  slug,
  newsletterId,
  issueId,
  allowHtml,
  senderVerified,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  issueId: string
  allowHtml: boolean
  senderVerified: boolean
}) {
  const issue = useCrmNewsletterIssue(workspaceId, newsletterId, issueId)
  const brand = useCrmEmailBrand(workspaceId)
  const stored = issue.data?.builderDocument
  const doc = useMemo(
    () =>
      issue.data
        ? (openEmailDocument(stored) ?? createBlankEmailDocument())
        : null,
    // Opened once per load: the editor keeps its own state afterwards.
    [issue.data?.id],
  )

  if (issue.isError || brand.isError) {
    return (
      <Message href={newsletterHref(slug, newsletterId)} label='Voltar'>
        Não foi possível carregar a edição. Tente de novo em instantes.
      </Message>
    )
  }
  if (!issue.data || !brand.data || !doc) {
    return (
      <div className='flex h-full flex-col gap-3 p-3' aria-busy='true'>
        <Skeleton className='h-10 w-full' />
        <div className='flex min-h-0 flex-1 gap-3'>
          <Skeleton className='hidden w-72 lg:block' />
          <Skeleton className='min-h-0 flex-1' />
          <Skeleton className='hidden w-80 lg:block' />
        </div>
      </div>
    )
  }
  if (issue.data.status !== 'DRAFT' && issue.data.status !== 'SCHEDULED') {
    return (
      <Message
        href={issueReportHref(slug, newsletterId, issueId)}
        label='Ver relatório'
      >
        Esta edição já foi enviada (ou está sendo) e não pode mais ser alterada.
      </Message>
    )
  }
  return (
    <NewsletterIssueCanvasEditor
      key={issue.data.id}
      workspaceId={workspaceId}
      slug={slug}
      newsletterId={newsletterId}
      issue={issue.data}
      brand={brand.data}
      initialDocument={doc}
      allowHtml={allowHtml}
      senderVerified={senderVerified}
    />
  )
}
