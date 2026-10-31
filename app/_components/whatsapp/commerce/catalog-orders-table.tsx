'use client'

import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useWhatsAppCatalogOrders } from '@/src/hooks/use-whatsapp-commerce'
import { formatBrl, formatInZone } from './commerce-format'

/** Carrinhos que os clientes enviaram a partir do catálogo. */
export function CatalogOrdersTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const orders = useWhatsAppCatalogOrders(workspaceId)

  if (orders.isLoading) return <Skeleton className='h-40 w-full' />
  if ((orders.data ?? []).length === 0) {
    return (
      <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Nenhum pedido ainda. Quando um cliente montar o carrinho no catálogo e
        enviar, ele aparece aqui.
      </p>
    )
  }

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Itens</TableHead>
            <TableHead className='text-right'>Total</TableHead>
            <TableHead>CRM</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.data?.map((order) => (
            <TableRow key={order.id}>
              <TableCell className='whitespace-nowrap'>
                {formatInZone(order.createdAt)}
              </TableCell>
              <TableCell>
                <p className='font-medium'>
                  {order.contactName ?? order.contactWaId}
                </p>
                {order.conversationId ? (
                  <Link
                    className='text-primary text-xs hover:underline'
                    href={`/${slug}/zap?conversation=${order.conversationId}`}
                  >
                    Abrir conversa
                  </Link>
                ) : null}
              </TableCell>
              <TableCell className='max-w-xs text-sm'>
                {order.items
                  .map((item) => `${item.quantity}x ${item.name}`)
                  .join(', ')}
              </TableCell>
              <TableCell className='text-right'>
                {formatBrl(order.total)}
              </TableCell>
              <TableCell>
                {order.opportunityId ? (
                  <Link
                    className='text-primary text-xs hover:underline'
                    href={`/${slug}/crm/opportunities?opportunity=${order.opportunityId}`}
                  >
                    Oportunidade
                  </Link>
                ) : (
                  <span className='text-muted-foreground text-xs'>-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
