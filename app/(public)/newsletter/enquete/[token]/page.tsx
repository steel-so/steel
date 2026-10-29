import type { Metadata } from 'next'
import { connection } from 'next/server'
import { NewsletterPollVote } from '@/app/_components/crm/newsletters/public/newsletter-poll-vote'
import {
  NewsletterInvalidLink,
  NewsletterPublicCard,
} from '@/app/_components/crm/newsletters/public/newsletter-public-card'
import { verifyPollVoteToken } from '@/src/lib/newsletter/poll-token'

export const metadata: Metadata = {
  title: 'Enquete da newsletter',
  robots: { index: false, follow: false },
}

/**
 * Option link of the "Enquete" block of an issue (nl2-engage). The GET only
 * checks the signature; the vote is a POST sent by the page once it loads,
 * so link scanners that prefetch e-mail links do not vote for anyone.
 */
export default async function NewsletterPollPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  if (!verifyPollVoteToken(token).ok) {
    return (
      <NewsletterPublicCard>
        <NewsletterInvalidLink what='enquete' />
      </NewsletterPublicCard>
    )
  }
  return (
    <NewsletterPublicCard>
      <NewsletterPollVote token={token} />
    </NewsletterPublicCard>
  )
}
