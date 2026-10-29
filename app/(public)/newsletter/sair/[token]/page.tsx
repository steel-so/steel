import type { Metadata } from 'next'
import { connection } from 'next/server'
import {
  NewsletterInvalidLink,
  NewsletterPublicCard,
} from '@/app/_components/crm/newsletters/public/newsletter-public-card'
import { NewsletterUnsubscribeConfirm } from '@/app/_components/crm/newsletters/public/newsletter-unsubscribe-confirm'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'

export const metadata: Metadata = {
  title: 'Sair da newsletter',
  robots: { index: false, follow: false },
}

/**
 * Footer link of every issue (ADR 0054). The GET only shows the address:
 * leaving takes the click (POST), so link scanners never unsubscribe anyone.
 */
export default async function NewsletterUnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  const preview = await CrmNewsletterPublicService.unsubscribePreview(token)

  if (!preview.ok) {
    return (
      <NewsletterPublicCard>
        <NewsletterInvalidLink what='descadastro' />
      </NewsletterPublicCard>
    )
  }

  const { email, newsletterName, alreadyUnsubscribed, preferencesUrl } =
    preview.value
  return (
    <NewsletterPublicCard>
      {alreadyUnsubscribed ? (
        <div className='space-y-3'>
          <h1 className='font-semibold text-lg'>Você já saiu</h1>
          <p className='text-muted-foreground text-sm'>
            <span className='break-all'>{email}</span> não recebe a newsletter{' '}
            {newsletterName}.
          </p>
          <a
            href={preferencesUrl}
            className='text-primary text-sm underline underline-offset-2'
          >
            Gerenciar todas as newsletters
          </a>
        </div>
      ) : (
        <NewsletterUnsubscribeConfirm
          token={token}
          email={email}
          newsletterName={newsletterName}
          preferencesUrl={preferencesUrl}
        />
      )}
    </NewsletterPublicCard>
  )
}
