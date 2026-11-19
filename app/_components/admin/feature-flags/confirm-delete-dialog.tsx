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
import type { PlatformFlagDTO } from '@/types/platform-flag'

export function ConfirmDeleteDialog({
  flag,
  pending,
  onCancel,
  onConfirm,
}: {
  flag: PlatformFlagDTO | null
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={flag !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Excluir flag</DialogTitle>
          <DialogDescription>
            Excluir <code className='font-mono text-xs'>{flag?.key}</code>{' '}
            remove também as liberações por workspace. Código que ainda leia
            essa chave passa a tratá-la como desligada.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant='destructive' disabled={pending} onClick={onConfirm}>
            {pending ? 'Excluindo...' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
