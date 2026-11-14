'use client'

import { Call02Icon, WhatsappIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { useSteelAiCapabilities } from '@/src/hooks/use-steel-ai'
import {
  type CustomerContactTarget,
  useCustomerContact,
} from './use-customer-contact'

/**
 * "WhatsApp" and "Ligar" for a CRM person, company or deal. Hidden while the
 * workspace has no Comunicação module; a button that cannot work says why.
 * `hasPhone` is only passed when the caller already knows the record has no
 * number (a person); companies and deals are resolved by the server.
 */
export function CustomerContactButtons({
  workspaceId,
  slug,
  target,
  hasPhone = true,
  size = 'sm',
}: {
  workspaceId: string
  slug: string
  target: CustomerContactTarget
  hasPhone?: boolean
  size?: 'sm' | 'xs'
}) {
  const capabilities = useSteelAiCapabilities(workspaceId)
  const canStart = useCan('conversations', 'CREATE')
  const contact = useCustomerContact(workspaceId, slug)

  if (!(capabilities.data?.modules ?? []).includes('COMMUNICATION')) return null

  const blocked = !hasPhone
    ? 'Este cadastro não tem telefone'
    : !canStart
      ? 'Você não tem permissão para iniciar conversas'
      : null

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        type='button'
        size={size}
        variant='outline'
        disabled={contact.pending || blocked !== null}
        title={blocked ?? 'Abrir a conversa no WhatsApp'}
        onClick={() => contact.whatsapp(target)}
      >
        <SteelIcon icon={WhatsappIcon} strokeWidth={2} className='size-3.5' />
        WhatsApp
      </Button>
      <Button
        type='button'
        size={size}
        variant='outline'
        disabled={contact.pending || blocked !== null}
        title={blocked ?? contact.callHint ?? 'Ligar para o contato'}
        onClick={() => void contact.call(target)}
      >
        <SteelIcon icon={Call02Icon} strokeWidth={2} className='size-3.5' />
        Ligar
      </Button>
    </div>
  )
}
