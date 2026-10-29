'use client'

import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL } from '@/src/lib/whatsapp/flows/editor-model'
import type { WhatsAppFlowStatusDTO } from '@/types/whatsapp-flow'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function formatFlowDate(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : '—'
}

export function FlowStatusBadge({ status }: { status: WhatsAppFlowStatusDTO }) {
  return (
    <Badge
      variant={
        status === 'PUBLISHED'
          ? 'default'
          : status === 'DEPRECATED'
            ? 'secondary'
            : 'outline'
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}
