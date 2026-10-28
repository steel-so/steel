import type { Metadata } from 'next'
import { connection } from 'next/server'
import { NewsletterPreferencesForm } from '@/app/_components/crm/newsletters/public/newsletter-preferences-form'
import {
  NewsletterInvalidLink,
  NewsletterPublicCard,
} from '@/app/_components/crm/newsletters/public/newsletter-public-card'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'

export const metadata: Metadata = {
  title: 'Preferências de e-mail',
  robots: { index: false, follow: false },
}

/** Preference center of one address in one workspace (ADR 0054). */
export default async function NewsletterPreferencesPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()
  const { token } = await params
  const preferences = await CrmNewsletterPublicService.getPreferences(token)

  return (
    <NewsletterPublicCard wide>
      {preferences.ok ? (
        <NewsletterPreferencesForm token={token} initial={preferences.value} />
      ) : (
        <NewsletterInvalidLink what='preferências' />
      )}
    </NewsletterPublicCard>
  )
}
