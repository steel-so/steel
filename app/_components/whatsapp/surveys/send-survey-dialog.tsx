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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { useSendSurvey } from '@/src/hooks/use-satisfaction-surveys'
import type { SurveyKindDTO } from '@/types/satisfaction-survey'
import { KIND_HINT, KIND_LABEL } from './survey-labels'

export interface SendSurveyRecipient {
  /** Contact of the Comunicação module: the survey goes over WhatsApp. */
  whatsappContactId?: string
  email?: string
  /** Name shown in the report (and in the e-mail greeting). */
  name?: string | null
}

/**
 * Sends a satisfaction survey now, outside the automatic rules (post-sale,
 * a conversation that was never closed, a ticket answered by e-mail). Calls
 * the manual-send route; the report treats it as a `MANUAL` survey.
 */
export function SendSurveyDialog({
  workspaceId,
  open,
  onOpenChange,
  recipient,
  defaultKind = 'CSAT',
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  recipient: SendSurveyRecipient
  defaultKind?: SurveyKindDTO
}) {
  const send = useSendSurvey(workspaceId)
  const [kind, setKind] = useState<SurveyKindDTO>(defaultKind)
  const [email, setEmail] = useState(recipient.email ?? '')

  const needsEmail = !recipient.whatsappContactId
  const canSend = !needsEmail || email.trim().length > 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
    send.mutate(
      {
        kind,
        ...(recipient.whatsappContactId
          ? { whatsappContactId: recipient.whatsappContactId }
          : { email: email.trim() }),
        ...(recipient.name ? { recipientName: recipient.name } : {}),
      },
      {
        onSuccess: () => {
          notify.success('Pesquisa enviada')
          onOpenChange(false)
        },
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Enviar pesquisa de satisfação</DialogTitle>
          <DialogDescription>
            {recipient.whatsappContactId
              ? 'O contato recebe a pergunta agora, no WhatsApp da conversa. Sem conexão ativa, vai por e-mail quando houver endereço.'
              : 'O solicitante recebe um link por e-mail para responder.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label>Tipo de pesquisa</Label>
            <Select
              value={kind}
              onValueChange={(value) =>
                value && setKind(value as SurveyKindDTO)
              }
            >
              <SelectTrigger aria-label='Tipo de pesquisa'>
                <SelectValue>{KIND_LABEL[kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(KIND_LABEL) as SurveyKindDTO[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {KIND_LABEL[item]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>{KIND_HINT[kind]}</p>
          </div>
          {needsEmail ? (
            <div className='space-y-1.5'>
              <Label htmlFor='send-survey-email'>E-mail do destinatário</Label>
              <Input
                id='send-survey-email'
                type='email'
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder='cliente@empresa.com.br'
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={!canSend || send.isPending}>
              {send.isPending ? 'Enviando…' : 'Enviar pesquisa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
