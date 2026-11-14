'use client'

import { useCallback, useState } from 'react'
import { ZapContextSlot } from '@/app/_components/customer-360/zap-context-slot'
import { ZapOnboardingChecklist } from '@/app/_components/onboarding-checklist/zap-onboarding-checklist'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppRealtimeEvents } from '@/src/hooks/use-whatsapp-events'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import { WhatsappConversationSidebar } from './whatsapp-conversation-sidebar'
import { WhatsappConversationView } from './whatsapp-conversation-view'

/** Why a `?conversa=` link did not open a conversation. */
function UnavailableNotice({
  onDismiss,
  className,
}: {
  onDismiss: () => void
  className?: string
}) {
  return (
    <div
      role='alert'
      className={cn(
        'max-w-md space-y-2 rounded-md border bg-muted px-4 py-3 text-foreground',
        className,
      )}
    >
      <p className='font-medium'>
        Essa conversa não está disponível para você.
      </p>
      <p className='text-muted-foreground text-xs'>
        Ela pode ter sido transferida para outra equipe ou outro atendente, ter
        sido apagada, ou você não tem acesso a ela. Fale com quem enviou o link
        ou com o administrador.
      </p>
      <Button size='sm' variant='outline' onClick={onDismiss}>
        Entendi
      </Button>
    </div>
  )
}

export function WhatsappPageClient({
  workspaceId,
  slug,
  initialConversation = null,
  conversationUnavailable = false,
}: {
  workspaceId: string
  /** Workspace slug, for the links of the customer context panel. */
  slug: string
  initialConversation?: WhatsAppConversationDTO | null
  /** A `?conversa=` link pointed at a conversation this user cannot open. */
  conversationUnavailable?: boolean
}) {
  const [selected, setSelected] = useState<WhatsAppConversationDTO | null>(
    initialConversation,
  )
  const [connectionId, setConnectionId] = useState<string | undefined>(
    undefined,
  )
  const [unavailableDismissed, setUnavailableDismissed] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const connections = useWhatsAppConnections(workspaceId)

  // Keep the open conversation in step with the refetched list (new inbound
  // message, new assignee...) without losing the selection.
  const refreshSelected = useCallback(
    (fresh: WhatsAppConversationDTO) =>
      setSelected((current) =>
        current &&
        current.id === fresh.id &&
        current.updatedAt !== fresh.updatedAt
          ? fresh
          : current,
      ),
    [],
  )

  const realtime = useWhatsAppRealtimeEvents(workspaceId)
  const selectedConnection =
    connections.data?.find(
      (connection) => connection.id === selected?.connectionId,
    ) ?? null
  const showUnavailable = conversationUnavailable && !unavailableDismissed

  return (
    // Below `lg` the module rail, the conversation list (w-80) and the chat
    // do not fit side by side — the chat was squeezed to a sliver with an
    // unusable composer — so the list and the chat take turns there.
    <div className='relative flex h-full w-full'>
      {realtime === 'reconnecting' ? (
        <output
          className='absolute top-2 right-3 z-10 rounded-full border bg-background px-2.5 py-1 text-muted-foreground text-xs shadow-sm'
          title='A conexão em tempo real caiu. As conversas são atualizadas a cada 15 segundos até ela voltar.'
        >
          Reconectando…
        </output>
      ) : null}
      {/* The empty state below is hidden under `lg`, so the notice gets its
          own spot there: over the conversation list. */}
      {showUnavailable && !selected ? (
        <div className='absolute inset-x-3 top-3 z-10 lg:hidden'>
          <UnavailableNotice
            className='text-left shadow-md'
            onDismiss={() => setUnavailableDismissed(true)}
          />
        </div>
      ) : null}
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
          onSelectedRefresh={refreshSelected}
        />
      </div>
      {selected ? (
        <>
          <WhatsappConversationView
            key={selected.id}
            workspaceId={workspaceId}
            conversation={selected}
            connection={selectedConnection}
            connectionMissing={connections.isSuccess && !selectedConnection}
            onSelectConversation={setSelected}
            onBack={() => setSelected(null)}
            contextOpen={contextOpen}
            onToggleContext={() => setContextOpen((open) => !open)}
          />
          <ZapContextSlot
            workspaceId={workspaceId}
            slug={slug}
            conversation={{
              id: selected.id,
              contactName: selected.contactName,
              contactWaId: selected.contactWaId,
            }}
            open={contextOpen}
            onOpenChange={setContextOpen}
          />
        </>
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 text-center text-muted-foreground text-sm max-lg:hidden'>
          {showUnavailable ? (
            <UnavailableNotice
              onDismiss={() => setUnavailableDismissed(true)}
            />
          ) : null}
          <ZapOnboardingChecklist workspaceId={workspaceId} />
          <p>Selecione uma conversa para começar</p>
        </div>
      )}
    </div>
  )
}
