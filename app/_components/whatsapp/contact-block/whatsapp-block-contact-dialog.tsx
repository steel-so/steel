'use client'

import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  type BlockWhatsAppContactInput,
  useBlockWhatsAppContact,
} from '@/src/hooks/use-whatsapp-contact-blocks'
import { WHATSAPP_CONTACT_BLOCK_REASON_MAX } from '@/src/schemas/whatsapp-contact-block.schema'
import type { WhatsAppContactBlockDTO } from '@/types/whatsapp-contact-block'

/** What happens at the provider, in plain words. */
function providerNote(provider: WhatsAppContactBlockDTO['provider']): string {
  if (provider === 'META') {
    return 'Na Meta: ela só aceita bloquear quem mandou mensagem para este número nas últimas 24 horas. Se já passou disso, o bloqueio vale no Steel agora e é enviado à Meta assim que a pessoa escrever de novo.'
  }
  return 'No WhatsApp: o contato também fica bloqueado no aparelho conectado pela Z-API.'
}

/**
 * "Bloquear contato": optional reason and what the block does. Used by the
 * conversation header and the contact panel of the inbox.
 */
export function WhatsappBlockContactDialog({
  workspaceId,
  open,
  onOpenChange,
  target,
  contactName,
  provider,
  onBlocked,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  target: Omit<BlockWhatsAppContactInput, 'reason'>
  contactName: string
  provider: WhatsAppContactBlockDTO['provider']
  onBlocked?: (block: WhatsAppContactBlockDTO) => void
}) {
  const blockContact = useBlockWhatsAppContact(workspaceId)
  const [reason, setReason] = useState('')
  const reasonId = 'whatsapp-block-reason'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await blockContact.mutateAsync({
        ...target,
        reason: reason.trim() || null,
      })
      if (result.block.providerStatus === 'APPLIED') {
        notify.success(result.notice)
      } else {
        notify.warning(result.notice)
      }
      setReason('')
      onOpenChange(false)
      onBlocked?.(result.block)
    } catch (error) {
      notify.error(error, 'Não foi possível bloquear o contato.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{`Bloquear ${contactName}?`}</DialogTitle>
          <DialogDescription>
            O bloqueio vale só para este número do WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <ul className='list-disc space-y-1.5 pl-5 text-muted-foreground text-sm'>
            <li>
              As mensagens dessa pessoa deixam de chegar ao Steel: sem conversa,
              notificação, IA ou chatbot.
            </li>
            <li>
              Nada é enviado a ela por este número: atendimento, templates,
              transmissões e campanhas.
            </li>
            <li>{providerNote(provider)}</li>
            <li>Só administradores e líderes de equipe podem desbloquear.</li>
          </ul>
          <div className='space-y-1.5'>
            <Label htmlFor={reasonId}>Motivo (opcional)</Label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={WHATSAPP_CONTACT_BLOCK_REASON_MAX}
              placeholder='Ex.: mensagens ofensivas, spam'
              onChange={(event) => setReason(event.target.value)}
            />
            <p className='text-right text-muted-foreground text-xs tabular-nums'>
              {`${reason.length}/${WHATSAPP_CONTACT_BLOCK_REASON_MAX}`}
            </p>
          </div>
          <DialogFooter className='gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={blockContact.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              variant='destructive'
              disabled={blockContact.isPending}
            >
              {blockContact.isPending ? 'Bloqueando...' : 'Bloquear contato'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
