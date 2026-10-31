'use client'

import {
  Cancel01Icon,
  Copy01Icon,
  Invoice01Icon,
  Link01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useCancelWhatsAppBoletoCharge } from '@/src/hooks/use-whatsapp-boleto'
import type {
  WhatsAppBoletoChargeDTO,
  WhatsAppBoletoChargeStatusDTO,
} from '@/types/whatsapp-boleto'

/** Boletos are Brazilian: amounts in BRL and dates in São Paulo time. */
const BOLETO_TIMEZONE = 'America/Sao_Paulo'

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BOLETO_TIMEZONE,
})

export const BOLETO_STATUS_LABEL: Record<WhatsAppBoletoChargeStatusDTO, string> =
  {
    PENDING: 'Aguardando pagamento',
    PAID: 'Pago',
    EXPIRED: 'Vencido',
    CANCELED: 'Cancelado',
    REFUNDED: 'Estornado',
  }

const STATUS_VARIANT: Record<
  WhatsAppBoletoChargeStatusDTO,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'secondary',
  PAID: 'default',
  EXPIRED: 'outline',
  CANCELED: 'destructive',
  REFUNDED: 'outline',
}

function formatDay(iso: string): string {
  return DATE.format(new Date(iso))
}

/** "Vence em 12/11/2026", "Pago em ...", "Cancelado em ..." */
export function boletoStatusLine(charge: WhatsAppBoletoChargeDTO): string {
  switch (charge.status) {
    case 'PAID':
      return `Pago em ${formatDay(charge.paidAt ?? charge.createdAt)}`
    case 'CANCELED':
      return `Cancelado em ${formatDay(charge.canceledAt ?? charge.createdAt)}`
    case 'EXPIRED':
      return `Venceu em ${formatDay(charge.dueAt)}`
    case 'REFUNDED':
      return 'Pagamento estornado'
    default:
      return `Vence em ${formatDay(charge.dueAt)}`
  }
}

/**
 * Card of a boleto sent in the conversation: value, state (pago, vencido...),
 * digitable line to copy and the link to view or print it. A pending boleto
 * can be closed on our side by whoever can edit the conversation.
 */
export function WhatsappBoletoChargeCard({
  workspaceId,
  charge,
  canManage = false,
  className,
}: {
  workspaceId: string
  charge: WhatsAppBoletoChargeDTO
  /** Shows "Cancelar boleto" on a pending charge. */
  canManage?: boolean
  className?: string
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancel = useCancelWhatsAppBoletoCharge(
    workspaceId,
    charge.conversationId,
  )
  const pending = charge.status === 'PENDING'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(charge.barCode)
      notify.success('Linha digitável copiada')
    } catch {
      notify.error('Não foi possível copiar a linha digitável')
    }
  }

  function handleCancel() {
    cancel.mutate(charge.id, {
      onSuccess: () => notify.success('Boleto cancelado'),
      onError: (error) =>
        notify.error(error, 'Não foi possível cancelar o boleto'),
    })
    setConfirmCancel(false)
  }

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border bg-card p-3 text-card-foreground',
        className,
      )}
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <SteelIcon
            icon={Invoice01Icon}
            size={18}
            className='shrink-0 text-primary'
          />
          <div className='min-w-0'>
            <p className='font-medium text-sm'>
              Boleto · {BRL.format(charge.amount)}
            </p>
            <p className='truncate text-muted-foreground text-xs'>
              {charge.description}
            </p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[charge.status]}>
          {BOLETO_STATUS_LABEL[charge.status]}
        </Badge>
      </div>

      <p className='text-muted-foreground text-xs'>
        {boletoStatusLine(charge)} · {charge.payerName}
        {charge.status === 'PAID' &&
        charge.paidAmount !== null &&
        charge.paidAmount !== charge.amount
          ? ` · valor recebido ${BRL.format(charge.paidAmount)}`
          : ''}
      </p>

      {pending ? (
        <>
          <p className='break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs'>
            {charge.barCode}
          </p>
          <div className='flex flex-wrap gap-1.5'>
            <Button variant='outline' size='xs' onClick={handleCopy}>
              <SteelIcon icon={Copy01Icon} size={14} />
              Copiar linha digitável
            </Button>
            {charge.url ? (
              <Button
                variant='outline'
                size='xs'
                nativeButton={false}
                render={
                  <a href={charge.url} target='_blank' rel='noreferrer' />
                }
              >
                <SteelIcon icon={Link01Icon} size={14} />
                Ver boleto
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant='ghost'
                size='xs'
                disabled={cancel.isPending}
                onClick={() => setConfirmCancel(true)}
              >
                <SteelIcon icon={Cancel01Icon} size={14} />
                Cancelar boleto
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar o boleto?</AlertDialogTitle>
            <AlertDialogDescription>
              O boleto sai da lista de pendentes do Steel, mas o banco não
              permite anulá-lo: se o contato pagar mesmo assim, o pagamento
              ainda será registrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>
              Cancelar boleto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
