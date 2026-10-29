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
import {
  useCreateWhatsAppPixCharge,
  useWhatsAppPixOpportunityOptions,
} from '@/src/hooks/use-whatsapp-pix'
import {
  PIX_EXPIRY_OPTIONS,
  parsePixAmount,
} from '@/src/lib/whatsapp/pix-amount'
import {
  PIX_DESCRIPTION_MAX,
  PIX_MAX_AMOUNT,
} from '@/src/schemas/whatsapp-pix.schema'
import type { WhatsAppPixSettingsDTO } from '@/types/whatsapp-pix'

const NO_OPPORTUNITY = 'none'

/** "Cobrar via Pix": value, text, validity and the CRM deal it belongs to. */
export function WhatsappPixChargeDialog({
  workspaceId,
  conversationId,
  settings,
  open,
  onOpenChange,
}: {
  workspaceId: string
  conversationId: string
  settings: WhatsAppPixSettingsDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState(
    settings.defaultExpiresMinutes,
  )
  const [opportunityId, setOpportunityId] = useState(NO_OPPORTUNITY)
  const create = useCreateWhatsAppPixCharge(workspaceId, conversationId)
  const opportunities = useWhatsAppPixOpportunityOptions(workspaceId, open)

  const expiryItems = PIX_EXPIRY_OPTIONS.some(
    (option) => option.minutes === settings.defaultExpiresMinutes,
  )
    ? PIX_EXPIRY_OPTIONS.map((option) => ({
        value: String(option.minutes),
        label: option.label,
      }))
    : [
        {
          value: String(settings.defaultExpiresMinutes),
          label: `${settings.defaultExpiresMinutes} minutos`,
        },
        ...PIX_EXPIRY_OPTIONS.map((option) => ({
          value: String(option.minutes),
          label: option.label,
        })),
      ]
  const opportunityItems = [
    { value: NO_OPPORTUNITY, label: 'Nenhuma' },
    ...(opportunities.data ?? []).map((opportunity) => ({
      value: opportunity.id,
      label: opportunity.name,
    })),
  ]

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parsePixAmount(amountText)
    if (amount === null || amount > PIX_MAX_AMOUNT) {
      notify.error('Informe um valor válido, por exemplo 150,00')
      return
    }
    if (!description.trim()) {
      notify.error('Descreva o que está sendo cobrado')
      return
    }
    create.mutate(
      {
        amount,
        description: description.trim(),
        expiresInMinutes,
        ...(opportunityId === NO_OPPORTUNITY ? {} : { opportunityId }),
      },
      {
        onSuccess: () => {
          notify.success('Cobrança Pix enviada')
          setAmountText('')
          setDescription('')
          setOpportunityId(NO_OPPORTUNITY)
          onOpenChange(false)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível enviar a cobrança'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Cobrar via Pix</DialogTitle>
            <DialogDescription>
              O contato recebe o resumo e o código "copia e cola" na conversa.
              Quando ele pagar, a conversa mostra o aviso de pagamento.
            </DialogDescription>
          </DialogHeader>

          {settings.isTestProvider ? (
            <p className='rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs'>
              Provedor de teste: o código enviado não é liquidado por nenhum
              banco. Um administrador pode simular o pagamento na cobrança.
            </p>
          ) : null}

          <div className='space-y-1.5'>
            <Label htmlFor='pix-amount'>Valor (R$)</Label>
            <Input
              id='pix-amount'
              inputMode='decimal'
              autoComplete='off'
              placeholder='150,00'
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='pix-description'>O que está sendo cobrado</Label>
            <Input
              id='pix-description'
              maxLength={PIX_DESCRIPTION_MAX}
              placeholder='Ex.: Mensalidade de novembro'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='pix-expiry'>Validade</Label>
            <Select
              items={expiryItems}
              value={String(expiresInMinutes)}
              onValueChange={(next) => {
                if (next) setExpiresInMinutes(Number(next))
              }}
            >
              <SelectTrigger id='pix-expiry' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {expiryItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {opportunities.data ? (
            <div className='space-y-1.5'>
              <Label htmlFor='pix-opportunity'>Oportunidade do CRM</Label>
              <Select
                items={opportunityItems}
                value={opportunityId}
                onValueChange={(next) => {
                  if (next) setOpportunityId(next as string)
                }}
              >
                <SelectTrigger id='pix-opportunity' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {opportunityItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                A oportunidade recebe uma anotação quando o pagamento chegar.
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={create.isPending}>
              {create.isPending ? 'Enviando...' : 'Enviar cobrança'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
