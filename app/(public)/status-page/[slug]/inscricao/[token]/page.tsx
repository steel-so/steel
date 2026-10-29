import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { SdStatusSubscriptionCard } from '@/app/_components/status-page/sd-status-subscription-card'
import {
  SdStatusSlugParamSchema,
  SdStatusTokenSchema,
} from '@/src/schemas/sd-status-page.schema'

export const metadata: Metadata = {
  title: 'Inscrição na página de status',
  robots: { index: false, follow: false },
}

/** Confirmação / cancelamento da inscrição: o clique faz a mudança. */
export default async function StatusSubscriptionPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>
}) {
  await connection()
  const { slug, token } = await params
  const parsedSlug = SdStatusSlugParamSchema.safeParse(slug)
  const parsedToken = SdStatusTokenSchema.safeParse(token)
  if (!parsedSlug.success || !parsedToken.success) notFound()

  return (
    <div className='flex min-h-screen items-center justify-center bg-muted/30 p-6'>
      <div className='w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm'>
        <SdStatusSubscriptionCard
          slug={parsedSlug.data}
          token={parsedToken.data}
        />
      </div>
    </div>
  )
}
