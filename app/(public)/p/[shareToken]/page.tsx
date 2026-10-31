import type { Metadata } from 'next'
import { connection } from 'next/server'
import { ProposalPublicActions } from '@/app/_components/crm/deals/public/proposal-public-actions'
import { ProposalWebPreview } from '@/app/_components/crm/proposal/proposal-preview-panel'
import { ProposalTracker } from '@/app/_components/crm/proposal/proposal-tracker'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { CrmProposalService } from '@/src/services/crm-proposal.service'

type PageProps = { params: Promise<{ shareToken: string }> }

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { shareToken } = await params
  const result = await CrmProposalService.getPublicByShareToken(shareToken)
  return {
    title: result.ok ? result.value.name : 'Proposta',
    robots: NO_INDEX,
  }
}

export default async function PublicCrmProposalPage({ params }: PageProps) {
  // Depende de estado ao vivo (status de envio) — nunca prerenderizar.
  await connection()

  const { shareToken } = await params
  const result = await CrmProposalService.getPublicByShareToken(shareToken)

  if (!result.ok) {
    return (
      <main className='flex min-h-svh flex-col items-center justify-center gap-2 px-6 text-center'>
        <h1 className='font-semibold text-lg'>Proposta indisponível</h1>
        <p className='max-w-md text-muted-foreground text-sm'>
          Este link pode não existir mais ou ainda não foi enviado. Peça um novo
          link para quem compartilhou a proposta.
        </p>
      </main>
    )
  }

  const proposal = result.value
  const checkout = await CrmProposalPaymentService.getPublicCheckout(shareToken)

  return (
    <main className='mx-auto min-h-svh w-full max-w-3xl px-6 py-12 sm:py-16'>
      <article className='flex flex-col gap-6'>
        <ProposalWebPreview sections={proposal.sections} />
      </article>
      <ProposalPublicActions
        token={shareToken}
        proposal={{
          validUntil: proposal.validUntil,
          isExpired: proposal.isExpired,
          canAccept: proposal.canAccept,
          acceptedAt: proposal.acceptedAt,
          acceptedByName: proposal.acceptedByName,
        }}
        checkout={checkout.ok ? checkout.value : null}
      />
      <ProposalTracker token={shareToken} />
    </main>
  )
}
