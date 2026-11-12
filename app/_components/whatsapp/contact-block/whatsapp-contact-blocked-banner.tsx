'use client'

import { UserBlock01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import type { WhatsAppContactBlockDTO } from '@/types/whatsapp-contact-block'
import { blockStatusHint } from './contact-block-format'

/** "Contato bloqueado" on top of a conversation whose contact is blocked. */
export function WhatsappContactBlockedBanner({
  block,
  canUnblock,
  isUnblocking,
  onUnblock,
}: {
  block: WhatsAppContactBlockDTO
  canUnblock: boolean
  isUnblocking: boolean
  onUnblock: () => void
}) {
  return (
    <div
      role='status'
      className='flex flex-col gap-2 border-b bg-destructive/10 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between'
    >
      <div className='flex min-w-0 items-start gap-2 text-destructive'>
        <SteelIcon icon={UserBlock01Icon} size={16} className='mt-0.5 shrink-0' />
        <div className='min-w-0'>
          <p className='font-medium'>Contato bloqueado neste número</p>
          <p className='text-muted-foreground text-xs'>
            {`As mensagens dele são ignoradas e nada é enviado a ele. ${blockStatusHint(block)}`}
            {canUnblock
              ? ''
              : ' Só administradores e líderes de equipe podem desbloquear.'}
          </p>
        </div>
      </div>
      {canUnblock ? (
        <Button
          size='xs'
          variant='outline'
          className='self-start sm:self-center'
          disabled={isUnblocking}
          onClick={onUnblock}
        >
          {isUnblocking ? 'Desbloqueando...' : 'Desbloquear'}
        </Button>
      ) : null}
    </div>
  )
}
