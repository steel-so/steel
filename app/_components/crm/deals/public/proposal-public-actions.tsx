'use client'

import { useState } from 'react'
import { ProposalAcceptPanel } from '@/app/_components/crm/proposal/proposal-accept-panel'
import type { CrmProposalPublicCheckoutDTO } from '@/types/crm-deals'
import type { CrmProposalPublicDTO } from '@/types/crm-proposal'
import { ProposalPaymentPanel } from '../proposal-payment-panel'

/**
 * Rodapé da proposta pública: aceite (por nome ou por assinatura) e, logo
 * depois, o pagamento. Depois do aceite o painel de pagamento busca a
 * cobrança que o vendedor possa ter criado.
 */
export function ProposalPublicActions({
  token,
  proposal,
  checkout,
}: {
  token: string
  proposal: Pick<
    CrmProposalPublicDTO,
    'validUntil' | 'isExpired' | 'canAccept' | 'acceptedAt' | 'acceptedByName'
  >
  checkout: CrmProposalPublicCheckoutDTO | null
}) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <>
      <ProposalAcceptPanel
        token={token}
        initial={proposal}
        signatureMode={checkout?.signatureEnabled ?? false}
        onAccepted={() => setRefreshKey((key) => key + 1)}
      />
      {checkout ? (
        <ProposalPaymentPanel
          token={token}
          initial={checkout}
          refreshKey={refreshKey}
        />
      ) : null}
    </>
  )
}
