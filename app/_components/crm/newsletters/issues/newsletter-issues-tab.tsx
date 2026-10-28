'use client'

/**
 * "Edições" tab of a newsletter. Contract placeholder (ADR 0054): the
 * nl-core slice mounts it in the newsletter page; the nl-issues slice
 * replaces the body (list, new issue, schedule, report links) keeping
 * this export and its props.
 */
export type NewsletterIssuesTabProps = {
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  /** False while the From domain is not verified: sending is blocked. */
  senderVerified: boolean
}

export function NewsletterIssuesTab(_props: NewsletterIssuesTabProps) {
  return (
    <p className='text-muted-foreground text-sm'>
      As edições aparecem aqui em breve.
    </p>
  )
}
