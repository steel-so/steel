'use client'

import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useMyWhatsAppPresence,
  useSetMyWhatsAppPresence,
} from '@/src/hooks/use-whatsapp-presence'

/**
 * Disponível / Ausente — the agent's own presence, in the WhatsApp sidebar.
 * It only matters when the workspace distributes the queue automatically:
 * an absent agent is skipped. Nothing flips it by itself.
 */
export function WhatsappPresenceToggle({
  workspaceId,
}: {
  workspaceId: string
}) {
  const presence = useMyWhatsAppPresence(workspaceId)
  const setPresence = useSetMyWhatsAppPresence(workspaceId)
  const available = presence.data?.status !== 'AWAY'

  return (
    <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'>
      <div className='min-w-0'>
        <p className='font-medium text-sm'>
          {available ? 'Disponível' : 'Ausente'}
        </p>
        <p className='text-muted-foreground text-xs'>
          {available
            ? 'Você recebe conversas da fila.'
            : 'Você não recebe conversas novas.'}
        </p>
      </div>
      <Switch
        aria-label='Disponível para receber conversas'
        checked={available}
        disabled={presence.isLoading || setPresence.isPending}
        onCheckedChange={(checked) =>
          setPresence.mutate(checked ? 'AVAILABLE' : 'AWAY', {
            onError: (error) =>
              notify.error(error, 'Não foi possível atualizar sua presença'),
          })
        }
      />
    </div>
  )
}
