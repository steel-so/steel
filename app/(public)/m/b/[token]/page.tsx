import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { MeetingManage } from '@/app/_components/crm/meetings/public/meeting-manage'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { CrmMeetingPublicService } from '@/src/services/crm-meeting-public.service'

export const metadata: Metadata = {
  title: 'Sua reunião',
  robots: NO_INDEX,
}

export default async function MeetingBookingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await connection()

  const { token } = await params
  const result = await CrmMeetingPublicService.getBooking(token)
  if (!result.ok) notFound()

  return (
    <div className='flex min-h-screen items-center justify-center bg-muted/30 p-6'>
      <main className='w-full max-w-lg'>
        <MeetingManage token={token} booking={result.value} />
      </main>
    </div>
  )
}
