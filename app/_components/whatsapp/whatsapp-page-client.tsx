'use client'

import { useState } from 'react'
import { ZapOnboardingChecklist } from '@/app/_components/onboarding-checklist/zap-onboarding-checklist'
import { cn } from '@/lib/utils'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppRealtimeEvents } from '@/src/hooks/use-whatsapp-events'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import { WhatsappConversationSidebar } from './whatsapp-conversation-sidebar'
import { WhatsappConversationView } from './whatsapp-conversation-view'

export function WhatsappPageClient({
  workspaceId,
  initialConversation = null,
}: {
  workspaceId: string
  initialConversation?: WhatsAppConversationDTO | null
}) {
  const [selected, setSelected] = useState<WhatsAppConversationDTO | null>(
    initialConversation,
  )
  const [connectionId, setConnectionId] = useState<string | undefined>(
    undefined,
  )
  const connections = useWhatsAppConnections(workspaceId)

  useWhatsAppRealtimeEvents(workspaceId)

  return (
    // Below `lg` the module rail, the conversation list (w-80) and the chat
    // do not fit side by side — the chat was squeezed to a sliver with an
    // unusable composer — so the list and the chat take turns there.
    <div className='flex h-full w-full'>
      <div
        className={cn(
          'flex h-full min-w-0 max-lg:[&>div]:w-full',
          selected ? 'max-lg:hidden' : 'max-lg:flex-1',
        )}
      >
        <WhatsappConversationSidebar
          workspaceId={workspaceId}
          connections={connections.data ?? []}
          connectionId={connectionId}
          onConnectionChange={setConnectionId}
          selectedConversationId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>
      {selected ? (
        <WhatsappConversationView
          workspaceId={workspaceId}
          conversation={selected}
          onSelectConversation={setSelected}
          onBack={() => setSelected(null)}
        />
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 text-muted-foreground text-sm max-lg:hidden'>
          <ZapOnboardingChecklist workspaceId={workspaceId} />
          <p>Selecione uma conversa para começar</p>
        </div>
      )}
    </div>
  )
}
