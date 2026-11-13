'use client'

import { Ticket01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { useSteelAiCapabilities } from '@/src/hooks/use-steel-ai'
import type { SdTicketSourceKindDTO } from '@/types/sd-ticket-source'
import { CreateTicketFromSourceDialog } from './create-ticket-from-source-dialog'

/** `true` when the workspace has the ServiceDesk module on. */
export function useHasServiceDesk(workspaceId: string): boolean {
  const capabilities = useSteelAiCapabilities(workspaceId)
  return (capabilities.data?.modules ?? []).includes('SERVICE_DESK')
}

/**
 * "Criar chamado" a partir de uma conversa ou registro do CRM. Some quando o
 * workspace não tem o ServiceDesk; quem não é agente recebe a explicação do
 * servidor ao abrir o diálogo.
 */
export function CreateTicketFromSourceButton({
  workspaceId,
  source,
  sourceId,
  iconOnly = false,
  label = 'Criar chamado',
}: {
  workspaceId: string
  source: SdTicketSourceKindDTO
  sourceId: string
  /** Header buttons of the conversation use only the icon. */
  iconOnly?: boolean
  label?: string
}) {
  const hasServiceDesk = useHasServiceDesk(workspaceId)
  const [open, setOpen] = useState(false)

  if (!hasServiceDesk) return null

  return (
    <>
      {iconOnly ? (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={label}
          title={label}
          onClick={() => setOpen(true)}
        >
          <SteelIcon icon={Ticket01Icon} size={18} />
        </Button>
      ) : (
        <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
          <SteelIcon icon={Ticket01Icon} size={16} />
          {label}
        </Button>
      )}
      {open ? (
        <CreateTicketFromSourceDialog
          workspaceId={workspaceId}
          source={source}
          sourceId={sourceId}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}
