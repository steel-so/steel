'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CopyField } from '../integration-kit'

/** Shows a signing secret (after create, rotate or reveal) with copy. */
export function WebhookSecretDialog({
  secret,
  title,
  description,
  onClose,
}: {
  secret: string | null
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <CopyField label='Segredo de assinatura' value={secret} />
        ) : null}
        <p className='text-xs text-muted-foreground'>
          Confira cada entrega calculando o HMAC-SHA256 de{' '}
          <code className='break-all'>
            {'"<Steel-Webhook-Timestamp>.<corpo>"'}
          </code>{' '}
          com este segredo e comparando com o cabeçalho{' '}
          <code>Steel-Signature</code> (<code>v1=…</code>).
        </p>
        <DialogFooter>
          <Button type='button' onClick={onClose}>
            Pronto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
