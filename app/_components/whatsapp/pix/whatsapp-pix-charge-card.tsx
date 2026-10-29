'use client'

import {
  Cancel01Icon,
  Copy01Icon,
  MoneyReceive01Icon,
  QrCodeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { renderSVG } from 'uqr'
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
import {
  useCancelWhatsAppPixCharge,
  useSimulateWhatsAppPixPayment,
} from '@/src/hooks/use-whatsapp-pix'
import type {
  WhatsAppPixChargeDTO,
  WhatsAppPixChargeStatusDTO,
} from '@/types/whatsapp-pix'

/** Pix is Brazilian: amounts in BRL and deadlines in São Paulo time. */
const PIX_TIMEZONE = 'America/Sao_Paulo'

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: PIX_TIMEZONE,
})

export const PIX_STATUS_LABEL: Record<WhatsAppPixChargeStatusDTO, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  EXPIRED: 'Vencida',
  CANCELED: 'Cancelada',
}

const STATUS_VARIANT: Record<
  WhatsAppPixChargeStatusDTO,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'secondary',
  PAID: 'default',
  EXPIRED: 'outline',
  CANCELED: 'destructive',
}

export function formatPixBrl(amount: number): string {
  return BRL.format(amount)
}

function formatWhen(iso: string): string {
  return DATE_TIME.format(new Date(iso)).replace(',', ' às')
}

/** "Vale até 12/11 às 14:30", "Pago em ...", "Cancelada em ..." */
function statusLine(charge: WhatsAppPixChargeDTO): string {
  switch (charge.status) {
    case 'PAID':
      return `Pago em ${formatWhen(charge.paidAt ?? charge.createdAt)}${
        charge.payerName ? ` por ${charge.payerName}` : ''
      }`
    case 'CANCELED':
      return `Cancelada em ${formatWhen(charge.canceledAt ?? charge.createdAt)}`
    case 'EXPIRED':
      return `Venceu em ${formatWhen(charge.expiresAt)}`
    default:
      return `Vale até ${formatWhen(charge.expiresAt)}`
  }
}

/**
 * Card of a Pix charge: value, state, copy-and-paste code and QR. In the
 * conversation it also cancels a pending charge; admins can settle one of a
 * test provider to try the whole flow.
 */
export function WhatsappPixChargeCard({
  workspaceId,
  charge,
  canManage = false,
  canSimulate = false,
  className,
}: {
  workspaceId: string
  charge: WhatsAppPixChargeDTO
  /** Shows "Cancelar cobrança" on a pending charge. */
  canManage?: boolean
  /** Shows "Simular pagamento" (test provider + OWNER/ADMIN). */
  canSimulate?: boolean
  className?: string
}) {
  const [qrOpen, setQrOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancel = useCancelWhatsAppPixCharge(workspaceId, charge.conversationId)
  const simulate = useSimulateWhatsAppPixPayment(
    workspaceId,
    charge.conversationId,
  )
  const pending = charge.status === 'PENDING'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(charge.brCode)
      notify.success('Código Pix copiado')
    } catch {
      notify.error('Não foi possível copiar o código')
    }
  }

  function handleCancel() {
    cancel.mutate(charge.id, {
      onSuccess: () => notify.success('Cobrança cancelada'),
      onError: (error) =>
        notify.error(error, 'Não foi possível cancelar a cobrança'),
    })
    setConfirmCancel(false)
  }

  function handleSimulate() {
    simulate.mutate(charge.id, {
      onSuccess: () => notify.success('Pagamento simulado'),
      onError: (error) =>
        notify.error(error, 'Não foi possível simular o pagamento'),
    })
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
            icon={MoneyReceive01Icon}
            size={18}
            className='shrink-0 text-primary'
          />
          <div className='min-w-0'>
            <p className='font-medium text-sm'>
              Cobrança Pix · {formatPixBrl(charge.amount)}
            </p>
            <p className='truncate text-muted-foreground text-xs'>
              {charge.description}
            </p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[charge.status]}>
          {PIX_STATUS_LABEL[charge.status]}
        </Badge>
      </div>

      <p className='text-muted-foreground text-xs'>
        {statusLine(charge)}
        {charge.createdByAi ? ' · enviada pela IA' : ''}
        {charge.status === 'PAID' &&
        charge.paidAmount !== null &&
        charge.paidAmount !== charge.amount
          ? ` · valor recebido ${formatPixBrl(charge.paidAmount)}`
          : ''}
      </p>

      {pending ? (
        <div className='flex flex-wrap gap-1.5'>
          <Button variant='outline' size='xs' onClick={handleCopy}>
            <SteelIcon icon={Copy01Icon} size={14} />
            Copiar código
          </Button>
          <Button
            variant='outline'
            size='xs'
            aria-expanded={qrOpen}
            onClick={() => setQrOpen((open) => !open)}
          >
            <SteelIcon icon={QrCodeIcon} size={14} />
            {qrOpen ? 'Esconder QR' : 'Ver QR'}
          </Button>
          {canManage ? (
            <Button
              variant='ghost'
              size='xs'
              disabled={cancel.isPending}
              onClick={() => setConfirmCancel(true)}
            >
              <SteelIcon icon={Cancel01Icon} size={14} />
              Cancelar cobrança
            </Button>
          ) : null}
          {canSimulate ? (
            <Button
              variant='ghost'
              size='xs'
              disabled={simulate.isPending}
              onClick={handleSimulate}
            >
              Simular pagamento
            </Button>
          ) : null}
        </div>
      ) : null}

      {pending && qrOpen ? (
        <div
          role='img'
          aria-label='QR code do Pix'
          className='mx-auto w-40 rounded-md bg-white p-2 [&_svg]:h-full [&_svg]:w-full'
          // uqr builds a self-contained SVG from the BR Code the server
          // generated: no user-controlled markup.
          dangerouslySetInnerHTML={{ __html: renderSVG(charge.brCode) }}
        />
      ) : null}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a cobrança Pix?</AlertDialogTitle>
            <AlertDialogDescription>
              O código enviado ao contato deixa de funcionar. Para cobrar de
              novo, envie uma nova cobrança.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>
              Cancelar cobrança
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
