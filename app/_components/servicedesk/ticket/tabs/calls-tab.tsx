'use client'

import { PhoneCallList } from '@/app/_components/phone-calls/phone-call-list'
import { SdAgentOnlyNotice } from '../shared/sd-tab-bits'
import type { SdTicketTabProps } from './types'

/**
 * Calls made from the WhatsApp conversation linked to the ticket, with the
 * recording, transcript, summary and "Criar tarefa" as a ticket task.
 */
export function SdTicketCallsTab({
  workspaceId,
  ticket,
  mode,
}: SdTicketTabProps) {
  if (mode !== 'agent') return <SdAgentOnlyNotice />
  return (
    <div className='flex flex-col gap-3'>
      <PhoneCallList
        workspaceId={workspaceId}
        source={{ kind: 'ticket', id: ticket.id }}
        taskTarget={() => ({ kind: 'ticket', ticketRef: ticket.id })}
      />
    </div>
  )
}
