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
  useCreateWhatsAppBoletoCharge,
  useWhatsAppBoletoSettings,
} from '@/src/hooks/use-whatsapp-boleto'
import { useWhatsAppPixOpportunityOptions } from '@/src/hooks/use-whatsapp-pix'
import { parsePixAmount } from '@/src/lib/whatsapp/pix-amount'
import {
  BOLETO_DESCRIPTION_MAX,
  BOLETO_MAX_AMOUNT,
  BOLETO_MIN_AMOUNT,
} from '@/src/schemas/whatsapp-boleto.schema'

const NO_OPPORTUNITY = 'none'

const DUE_OPTIONS = [
  { value: '1', label: '1 dia' },
  { value: '3', label: '3 dias' },
  { value: '5', label: '5 dias' },
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
]

/** "Enviar boleto": value, payer, due date and the CRM deal it belongs to. */
export function WhatsappBoletoChargeDialog({
  workspaceId,
  conversationId,
  defaultPayerName,
  open,
  onOpenChange,
}: {
  workspaceId: string
  conversationId: string
  defaultPayerName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [payerName, setPayerName] = useState(defaultPayerName ?? '')
  const [payerTaxId, setPayerTaxId] = useState('')
  const [dueInDays, setDueInDays] = useState('3')
  const [opportunityId, setOpportunityId] = useState(NO_OPPORTUNITY)
  const settings = useWhatsAppBoletoSettings(workspaceId, open)
  const create = useCreateWhatsAppBoletoCharge(workspaceId, conversationId)
  const opportunities = useWhatsAppPixOpportunityOptions(workspaceId, open)

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
    if (
      amount === null ||
      amount < BOLETO_MIN_AMOUNT ||
      amount > BOLETO_MAX_AMOUNT
    ) {
      notify.error('Informe um valor entre R$ 1,00 e R$ 999.999,99')
      return
    }
    if (!description.trim()) {
      notify.error('Descreva o que está sendo cobrado')
      return
    }
    if (payerName.trim().length < 2) {
      notify.error('Informe o nome do pagador')
      return
    }
    const digits = payerTaxId.replace(/\D/g, '')
    if (digits.length !== 11 && digits.length !== 14) {
      notify.error('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido')
      return
    }
    create.mutate(
      {
        amount,
        description: description.trim(),
        payerName: payerName.trim(),
        payerTaxId: digits,
        dueInDays: Number(dueInDays),
        ...(opportunityId === NO_OPPORTUNITY ? {} : { opportunityId }),
      },
      {
        onSuccess: () => {
          notify.success('Boleto enviado')
          setAmountText('')
          setDescription('')
          setPayerTaxId('')
          setOpportunityId(NO_OPPORTUNITY)
          onOpenChange(false)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível enviar o boleto'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Enviar boleto</DialogTitle>
            <DialogDescription>
              O contato recebe o resumo, a linha digitável e o link do boleto na
              conversa. Quando ele pagar, o boleto aparece como pago aqui.
            </DialogDescription>
          </DialogHeader>

          {settings.data?.isTestProvider ? (
            <p className='rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs'>
              Provedor de teste: o boleto enviado não é liquidado por nenhum
              banco.
            </p>
          ) : null}

          <div className='space-y-1.5'>
            <Label htmlFor='boleto-amount'>Valor (R$)</Label>
            <Input
              id='boleto-amount'
              inputMode='decimal'
              autoComplete='off'
              placeholder='150,00'
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='boleto-description'>O que está sendo cobrado</Label>
            <Input
              id='boleto-description'
              maxLength={BOLETO_DESCRIPTION_MAX}
              placeholder='Ex.: Mensalidade de novembro'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='boleto-payer'>Nome do pagador</Label>
              <Input
                id='boleto-payer'
                autoComplete='off'
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='boleto-tax-id'>CPF ou CNPJ</Label>
              <Input
                id='boleto-tax-id'
                inputMode='numeric'
                autoComplete='off'
                value={payerTaxId}
                onChange={(event) => setPayerTaxId(event.target.value)}
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='boleto-due'>Vence em</Label>
            <Select
              items={DUE_OPTIONS}
              value={dueInDays}
              onValueChange={(next) => {
                if (next) setDueInDays(next as string)
              }}
            >
              <SelectTrigger id='boleto-due' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {DUE_OPTIONS.map((item) => (
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
              <Label htmlFor='boleto-opportunity'>Oportunidade do CRM</Label>
              <Select
                items={opportunityItems}
                value={opportunityId}
                onValueChange={(next) => {
                  if (next) setOpportunityId(next as string)
                }}
              >
                <SelectTrigger id='boleto-opportunity' className='w-full'>
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
              {create.isPending ? 'Enviando...' : 'Enviar boleto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
