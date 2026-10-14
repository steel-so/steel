'use client'

import { UserGroup03Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'

/** Team the conversation is routed to — in the inbox list and the header. */
export function WhatsappTeamBadge({
  team,
  className,
}: {
  team: WhatsAppConversationDTO['team']
  className?: string
}) {
  if (!team) return null
  return (
    <Badge
      variant='outline'
      className={cn('max-w-28 text-muted-foreground', className)}
      title={`Equipe ${team.name}`}
    >
      <SteelIcon icon={UserGroup03Icon} size={11} />
      <span className='truncate'>{team.name}</span>
    </Badge>
  )
}
