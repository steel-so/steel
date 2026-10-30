import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { MeetingBookingWidget } from '@/app/_components/crm/meetings/public/meeting-booking-widget'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { CrmMeetingPublicService } from '@/src/services/crm-meeting-public.service'

export const metadata: Metadata = {
  title: 'Agendar reunião',
  robots: NO_INDEX,
}

/** Frame-friendly version of the booking page, for landing pages and sites. */
export default async function EmbeddedMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ name?: string; email?: string; phone?: string }>
}) {
  await connection()

  const [{ slug }, query] = await Promise.all([params, searchParams])
  const result = await CrmMeetingPublicService.getPage(slug)
  if (!result.ok) notFound()

  return (
    <main className='bg-background p-4'>
      <MeetingBookingWidget
        page={result.value}
        compact
        prefill={{ name: query.name, email: query.email, phone: query.phone }}
      />
    </main>
  )
}
