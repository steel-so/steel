'use client'

import { Badge } from '@/components/ui/badge'
import type { WhatsAppContactBlockDTO } from '@/types/whatsapp-contact-block'
import { blockStatusLabel } from './contact-block-format'

/** Provider status of a block: applied, waiting for the person, failed. */
export function WhatsappContactBlockStatusBadge({
  block,
}: {
  block: Pick<
    WhatsAppContactBlockDTO,
    'providerStatus' | 'provider' | 'providerError'
  >
}) {
  const label = blockStatusLabel(block.providerStatus, block.provider)
  if (block.providerStatus === 'FAILED') {
    return (
      <Badge
        variant='destructive'
        title={block.providerError ?? undefined}
        className='max-w-full'
      >
        <span className='truncate'>
          {block.providerError ? `${label}: ${block.providerError}` : label}
        </span>
      </Badge>
    )
  }
  return (
    <Badge variant={block.providerStatus === 'APPLIED' ? 'secondary' : 'outline'}>
      {label}
    </Badge>
  )
}
