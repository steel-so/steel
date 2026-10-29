'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useWhatsAppChatbotSessions } from '@/src/hooks/use-whatsapp-chatbots'
import {
  END_REASON_LABEL,
  SESSION_STATUS_LABEL,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import type { WhatsAppChatbotSessionStatusDTO } from '@/types/whatsapp-chatbot'
import { SimpleSelect } from './chatbot-select'
import { ChatbotSessionStatusBadge, formatChatbotDate } from './chatbot-ui'

const ALL = 'ALL'

/** Recent runs of the bot, with where each one ended. */
export function ChatbotSessions({
  workspaceId,
  chatbotId,
  slug,
}: {
  workspaceId: string
  chatbotId: string
  slug: string
}) {
  const [status, setStatus] = useState<string>(ALL)
  const sessions = useWhatsAppChatbotSessions(workspaceId, chatbotId, {
    status:
      status === ALL ? undefined : (status as WhatsAppChatbotSessionStatusDTO),
    limit: 50,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 p-4'>
      <SimpleSelect
        ariaLabel='Filtrar por situação'
        value={status}
        onChange={setStatus}
        options={[
          { value: ALL, label: 'Todas as situações' },
          ...(
            Object.keys(
              SESSION_STATUS_LABEL,
            ) as WhatsAppChatbotSessionStatusDTO[]
          ).map((value) => ({ value, label: SESSION_STATUS_LABEL[value] })),
        ]}
      />
      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto'>
        {sessions.isLoading ? (
          <Skeleton className='h-16 rounded-lg' />
        ) : (sessions.data ?? []).length === 0 ? (
          <p className='py-8 text-center text-muted-foreground text-sm'>
            Nenhuma conversa passou por este chatbot ainda.
          </p>
        ) : (
          (sessions.data ?? []).map((session) => (
            <div key={session.id} className='space-y-1 rounded-lg border p-3'>
              <div className='flex items-center justify-between gap-2'>
                <Link
                  href={`/${slug}/zap`}
                  className='truncate font-medium text-sm hover:underline'
                >
                  {session.contactName ?? session.contactPhone ?? 'Contato'}
                </Link>
                <ChatbotSessionStatusBadge status={session.status} />
              </div>
              <p className='text-muted-foreground text-xs'>
                Início {formatChatbotDate(session.startedAt)} · versão{' '}
                {session.botVersion}
              </p>
              {session.endReason ? (
                <p className='text-muted-foreground text-xs'>
                  {END_REASON_LABEL[session.endReason] ?? session.endReason}
                </p>
              ) : null}
              {Object.keys(session.variables).length > 0 ? (
                <p className='break-words text-xs'>
                  {Object.entries(session.variables)
                    .filter(
                      ([key]) =>
                        ![
                          'contact_name',
                          'contact_phone',
                          'last_message',
                        ].includes(key),
                    )
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
