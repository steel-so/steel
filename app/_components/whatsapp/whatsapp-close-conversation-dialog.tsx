'use client'

import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useWhatsAppCloseStatuses } from '@/src/hooks/use-whatsapp-close-statuses'
import { WhatsappCloseOutcomeBadge } from './whatsapp-close-outcome-badge'

const REASON_MAX = 500

function selectionHint(min: number, max: number): string {
  if (min === 0) {
    return max === 1 ? 'Opcional — escolha 1' : `Opcional — até ${max}`
  }
  if (min === max) return `Escolha ${min}`
  return `Escolha de ${min} a ${max}`
}

export function WhatsappCloseConversationDialog({
  workspaceId,
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string | undefined, statusIds: string[]) => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const options = useWhatsAppCloseStatuses(workspaceId, open)

  const statuses = options.data?.statuses ?? []
  const min = options.data?.minSelections ?? 0
  const max = options.data?.maxSelections ?? 1
  const hasStatuses = statuses.length > 0
  const missing = hasStatuses && selected.length < min

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      // Single choice: picking another one replaces it.
      if (max === 1) return [id]
      if (current.length >= max) return current
      return [...current, id]
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (missing) return
    onConfirm(reason.trim() || undefined, selected)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setSelected([])
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Fechar conversa</DialogTitle>
          <DialogDescription>
            A conversa sai da caixa de entrada ativa e a IA para de responder.
            Ela é reaberta automaticamente se o contato enviar uma nova
            mensagem.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          {hasStatuses && (
            <fieldset className='space-y-1.5'>
              <legend className='flex w-full items-center justify-between font-medium text-sm'>
                <span>Status do atendimento</span>
                <span className='font-normal text-muted-foreground text-xs'>
                  {selectionHint(min, max)}
                </span>
              </legend>
              <div className='max-h-56 space-y-1 overflow-y-auto rounded-md border p-2'>
                {statuses.map((status) => {
                  const checked = selected.includes(status.id)
                  const blocked = !checked && max > 1 && selected.length >= max
                  return (
                    <label
                      key={status.id}
                      htmlFor={`closeStatus-${status.id}`}
                      className='flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted has-disabled:cursor-not-allowed has-disabled:opacity-50'
                    >
                      <Checkbox
                        id={`closeStatus-${status.id}`}
                        checked={checked}
                        disabled={blocked}
                        onCheckedChange={() => toggle(status.id)}
                      />
                      <span className='flex-1'>{status.label}</span>
                      <WhatsappCloseOutcomeBadge outcome={status.outcome} />
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}
          <div className='space-y-1.5'>
            <Label htmlFor='closeReason'>Motivo (opcional)</Label>
            <Textarea
              id='closeReason'
              rows={3}
              maxLength={REASON_MAX}
              placeholder='Ex.: atendimento concluído'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type='submit'
              disabled={isPending || options.isLoading || missing}
            >
              {isPending ? 'Fechando...' : 'Fechar conversa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
