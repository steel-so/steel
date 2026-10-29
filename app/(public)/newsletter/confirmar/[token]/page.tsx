import type { Metadata } from 'next'
import { connection } from 'next/server'
import {
  NewsletterInvalidLink,
  NewsletterPublicCard,
} from '@/app/_components/crm/newsletters/public/newsletter-public-card'
import { NewsletterResendConfirmation } from '@/app/_components/crm/newsletters/public/newsletter-resend-confirmation'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'

export const metadata: Metadata = {
  title: 'Confirmar inscrição',
  robots: { index: false, follow: false },
}

/**
 * Double opt-in link of the newsletter (ADR 0054). Opening it confirms: the
 * signed token only serves this purpose and expires in 7 days; an expired
 * link offers a new one.
 */
export default async function NewsletterConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  const outcome = await CrmNewsletterPublicService.confirm(token, new Date())

  if (!outcome.ok) {
    return (
      <NewsletterPublicCard>
        <NewsletterInvalidLink what='confirmação' />
      </NewsletterPublicCard>
    )
  }

  if (outcome.value.state === 'expired') {
    return (
      <NewsletterPublicCard>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <h1 className='font-semibold text-lg'>Este link venceu</h1>
            <p className='text-muted-foreground text-sm'>
              O link para confirmar a inscrição em{' '}
              <strong>{outcome.value.newsletterName}</strong> vale por 7 dias.
              Peça um novo e confirme pelo e-mail.
            </p>
          </div>
          <NewsletterResendConfirmation token={token} />
        </div>
      </NewsletterPublicCard>
    )
  }

  const { newsletterName, publisherName, archiveUrl, preferencesUrl } =
    outcome.value
  return (
    <NewsletterPublicCard>
      <div className='space-y-3'>
        <h1 className='font-semibold text-lg'>Inscrição confirmada</h1>
        <p className='text-muted-foreground text-sm'>
          Você vai receber <strong>{newsletterName}</strong>, de {publisherName}
          . Dá para sair a qualquer momento pelo link no fim de cada e-mail.
        </p>
        <div className='flex flex-col gap-1 text-sm'>
          {archiveUrl ? (
            <a
              href={archiveUrl}
              className='text-primary underline underline-offset-2'
            >
              Ver as edições anteriores
            </a>
          ) : null}
          <a
            href={preferencesUrl}
            className='text-muted-foreground underline underline-offset-2'
          >
            Gerenciar minhas preferências
          </a>
        </div>
      </div>
    </NewsletterPublicCard>
  )
}
