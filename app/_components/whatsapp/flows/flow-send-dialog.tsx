'use client'

import { useState } from 'react'
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
import { notify } from '@/lib/notify'
import {
  useSendWhatsAppFlow,
  useWhatsAppFlows,
} from '@/src/hooks/use-whatsapp-flows'
import { SimpleSelect } from '../chatbots/chatbot-select'

function SendFlowForm({
  workspaceId,
  conversationId,
  onClose,
}: {
  workspaceId: string
  conversationId: string
  onClose: () => void
}) {
  const flows = useWhatsAppFlows(workspaceId)
  const [flowId, setFlowId] = useState('')
  const send = useSendWhatsAppFlow(workspaceId, flowId)

  const sendable = (flows.data ?? []).filter((flow) => flow.sendable)
  const selected = sendable.find((flow) => flow.id === flowId)

  const submit = () => {
    send.mutate(
      { conversationId },
      {
        onSuccess: () => {
          notify.success('Formulário enviado')
          onClose()
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  return (
    <>
      <div className='space-y-1.5'>
        <Label>Formulário</Label>
        <SimpleSelect
          ariaLabel='Formulário'
          value={flowId}
          placeholder={
            flows.isLoading ? 'Carregando...' : 'Escolha um formulário'
          }
          options={sendable.map((flow) => ({
            value: flow.id,
            label:
              flow.status === 'PUBLISHED'
                ? flow.name
                : `${flow.name} (rascunho na Meta)`,
          }))}
          onChange={setFlowId}
        />
        {flows.isSuccess && sendable.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            Nenhum formulário publicado. Crie e publique um em WhatsApp &gt;
            Formulários.
          </p>
        ) : null}
        {selected ? (
          <p className='rounded-md bg-muted p-2 text-muted-foreground text-xs'>
            O contato recebe “{selected.bodyText}” com o botão “
            {selected.ctaLabel}”. Só funciona dentro das 24 horas da última
            mensagem dele; fora disso use um template com o formulário.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type='button'
          disabled={!selected || send.isPending}
          onClick={submit}
        >
          Enviar formulário
        </Button>
      </DialogFooter>
    </>
  )
}

/** Picks a published flow and sends it into the open conversation. */
export function FlowSendDialog({
  workspaceId,
  conversationId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Enviar formulário</DialogTitle>
          <DialogDescription>
            O contato preenche as telas nativas do WhatsApp e a resposta volta
            para esta conversa.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SendFlowForm
            workspaceId={workspaceId}
            conversationId={conversationId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
