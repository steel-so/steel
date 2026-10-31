import type { Metadata } from 'next'
import { connection } from 'next/server'
import { DealRoomView } from '@/app/_components/crm/deals/public/deal-room-view'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'

type PageProps = { params: Promise<{ token: string }> }

export const metadata: Metadata = {
  title: 'Sala de negociação',
  robots: NO_INDEX,
}

export default async function PublicDealRoomPage({ params }: PageProps) {
  // Live state (messages, plan, openings): never prerender.
  await connection()

  const { token } = await params
  const result = await CrmDealRoomService.getPublic(token)

  if (!result.ok) {
    return (
      <main className='flex min-h-svh flex-col items-center justify-center gap-2 px-6 text-center'>
        <h1 className='font-semibold text-lg'>Sala indisponível</h1>
        <p className='max-w-md text-muted-foreground text-sm'>
          Este link pode ter sido desligado ou trocado. Peça um novo link para
          quem compartilhou a sala.
        </p>
      </main>
    )
  }

  return <DealRoomView token={token} initial={result.value} />
}
