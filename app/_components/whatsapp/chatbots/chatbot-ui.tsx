'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  SESSION_STATUS_LABEL,
  STATUS_LABEL,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import type { ChatbotStatus } from '@/src/schemas/whatsapp-chatbot.schema'
import type { WhatsAppChatbotSessionStatusDTO } from '@/types/whatsapp-chatbot'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function formatChatbotDate(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : '—'
}

export function ChatbotStatusBadge({
  status,
  className,
}: {
  status: ChatbotStatus
  className?: string
}) {
  return (
    <Badge
      variant={
        status === 'ACTIVE'
          ? 'default'
          : status === 'PAUSED'
            ? 'secondary'
            : 'outline'
      }
      className={cn(className)}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export function ChatbotSessionStatusBadge({
  status,
}: {
  status: WhatsAppChatbotSessionStatusDTO
}) {
  const variant =
    status === 'FAILED'
      ? 'destructive'
      : status === 'RUNNING'
        ? 'default'
        : status === 'COMPLETED' ||
            status === 'HANDED_OFF_AI' ||
            status === 'HANDED_OFF_HUMAN'
          ? 'secondary'
          : 'outline'
  return <Badge variant={variant}>{SESSION_STATUS_LABEL[status]}</Badge>
}
