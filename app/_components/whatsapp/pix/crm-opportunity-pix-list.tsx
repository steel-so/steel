'use client'

import { useCrmOpportunityPix } from '@/src/hooks/use-whatsapp-pix'
import { WhatsappPixChargeCard } from './whatsapp-pix-charge-card'

/**
 * Pix charges sent in WhatsApp conversations for a CRM deal, in the record
 * timeline. Renders nothing while there is none (or the viewer cannot read
 * them), so deals without Pix stay as they were.
 */
export function CrmOpportunityPixList({
  workspaceId,
  opportunityId,
}: {
  workspaceId: string
  opportunityId: string
}) {
  const charges = useCrmOpportunityPix(workspaceId, opportunityId)
  if (!charges.data || charges.data.length === 0) return null

  return (
    <div className='flex flex-col gap-2'>
      <span className='font-medium text-sm'>Cobranças Pix</span>
      {charges.data.map((charge) => (
        <WhatsappPixChargeCard
          key={charge.id}
          workspaceId={workspaceId}
          charge={charge}
        />
      ))}
    </div>
  )
}
