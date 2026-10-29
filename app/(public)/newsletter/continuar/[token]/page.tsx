import type { Metadata } from 'next'
import { connection } from 'next/server'
import { NewsletterReengageConfirm } from '@/app/_components/crm/newsletters/automation/newsletter-reengage-confirm'
import {
  NewsletterInvalidLink,
  NewsletterPublicCard,
} from '@/app/_components/crm/newsletters/public/newsletter-public-card'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'

export const metadata: Metadata = {
  title: 'Continuar recebendo a newsletter',
  robots: { index: false, follow: false },
}

/**
 * "Quero continuar recebendo" of the re-engagement e-mail (newsletter2,
 * nl2-automation). The GET only shows the address; the click confirms.
 */
export default async function NewsletterReengagePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  const preview = await CrmNewsletterReengagementService.reengagePreview(token)

  if (!preview.ok) {
    return (
      <NewsletterPublicCard>
        <NewsletterInvalidLink what='confirmação' />
      </NewsletterPublicCard>
    )
  }

  return (
    <NewsletterPublicCard>
      <NewsletterReengageConfirm
        token={token}
        email={preview.value.email}
        newsletterName={preview.value.newsletterName}
        alreadyConfirmed={preview.value.alreadyConfirmed}
      />
    </NewsletterPublicCard>
  )
}
