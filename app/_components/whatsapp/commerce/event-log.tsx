'use client'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useWhatsAppEcomEvents } from '@/src/hooks/use-whatsapp-commerce'
import type {
  WhatsAppEcomEventKindDTO,
  WhatsAppEcomEventStatusDTO,
} from '@/types/whatsapp-commerce'
import { formatInZone } from './commerce-format'

const KIND_LABEL: Record<WhatsAppEcomEventKindDTO, string> = {
  CART_ABANDONED: 'Carrinho abandonado',
  ORDER_CREATED: 'Pedido criado',
  ORDER_SHIPPED: 'Pedido enviado',
  ORDER_DELIVERED: 'Pedido entregue',
}

const STATUS: Record<
  WhatsAppEcomEventStatusDTO,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  PENDING: { label: 'Aguardando', variant: 'outline' },
  SENT: { label: 'Enviada', variant: 'default' },
  SKIPPED: { label: 'Ignorada', variant: 'secondary' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
}

/** Últimos eventos recebidos das lojas e o que o Steel fez com cada um. */
export function EventLog({ workspaceId }: { workspaceId: string }) {
  const events = useWhatsAppEcomEvents(workspaceId)

  if (events.isLoading) return <Skeleton className='h-40 w-full' />
  if ((events.data ?? []).length === 0) {
    return (
      <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Nenhum evento recebido das lojas ainda.
      </p>
    )
  }

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recebido</TableHead>
            <TableHead>Loja</TableHead>
            <TableHead>Evento</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.data?.map((event) => (
            <TableRow key={event.id}>
              <TableCell className='whitespace-nowrap'>
                {formatInZone(event.createdAt)}
              </TableCell>
              <TableCell>{event.storeName}</TableCell>
              <TableCell>{KIND_LABEL[event.kind]}</TableCell>
              <TableCell>{event.contactName ?? event.waId}</TableCell>
              <TableCell>
                <Badge variant={STATUS[event.status].variant}>
                  {STATUS[event.status].label}
                </Badge>
                {event.skipReason ? (
                  <p className='mt-1 text-muted-foreground text-xs'>
                    {event.skipReason}
                  </p>
                ) : null}
                {event.status === 'PENDING' ? (
                  <p className='mt-1 text-muted-foreground text-xs'>
                    Sai em {formatInZone(event.scheduledAt)}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
