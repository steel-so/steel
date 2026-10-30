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

export default async function PublicMeetingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  // Depends on live state (page active, module on): never prerender.
  await connection()

  const { slug } = await params
  const result = await CrmMeetingPublicService.getPage(slug)
  if (!result.ok) notFound()

  return (
    <div className='flex min-h-screen justify-center bg-muted/30 p-4 sm:p-6'>
      <main className='w-full max-w-2xl rounded-2xl border bg-background p-5 sm:p-8'>
        <MeetingBookingWidget page={result.value} />
      </main>
    </div>
  )
}
