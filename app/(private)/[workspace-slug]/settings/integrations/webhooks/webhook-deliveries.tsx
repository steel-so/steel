'use client'

import { RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useWebhookDeliveries,
  useWebhookMutations,
} from '@/src/hooks/use-webhooks'
import type {
  WebhookDeliveryDTO,
  WebhookDeliveryStatusDTO,
  WebhookEndpointDTO,
} from '@/types/webhook'
import { Field, formatIntegrationDate, PlainSelect } from '../integration-kit'
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_VARIANT,
  prettyBody,
  webhookHost,
} from './webhook-format'

/**
 * Delivery log (30 days): filter by endpoint and status, newest first,
 * "Carregar mais" by cursor, the request/answer of each one and the manual
 * re-delivery.
 */

const STATUS_OPTIONS = (
  Object.keys(DELIVERY_STATUS_LABEL) as WebhookDeliveryStatusDTO[]
).map((status) => ({ value: status, label: DELIVERY_STATUS_LABEL[status] }))

function DeliveryRow({
  delivery,
  endpoint,
  retrying,
  onRetry,
}: {
  delivery: WebhookDeliveryDTO
  endpoint: WebhookEndpointDTO | undefined
  retrying: boolean
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const when = formatIntegrationDate(
    delivery.lastAttemptAt ?? delivery.createdAt,
  )
  const canRetry =
    delivery.status !== 'PENDING' && delivery.status !== 'RETRYING'

  return (
    <li className='flex min-w-0 flex-col gap-2 border-b py-3 last:border-b-0'>
      <div className='flex min-w-0 flex-wrap items-center gap-2'>
        <Badge variant={DELIVERY_STATUS_VARIANT[delivery.status]}>
          {DELIVERY_STATUS_LABEL[delivery.status]}
        </Badge>
        <code className='min-w-0 break-all text-xs'>{delivery.eventType}</code>
        <span className='ml-auto text-xs text-muted-foreground'>{when}</span>
      </div>
      <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
        <span className='min-w-0 break-all'>
          {endpoint ? webhookHost(endpoint.url) : 'Endpoint removido'}
        </span>
        <span>
          {delivery.responseStatus !== null
            ? `HTTP ${delivery.responseStatus}`
            : 'Sem resposta'}
        </span>
        {delivery.durationMs !== null ? (
          <span>{delivery.durationMs} ms</span>
        ) : null}
        <span>
          {delivery.attempts === 1
            ? '1 tentativa'
            : `${delivery.attempts} tentativas`}
        </span>
        {delivery.error ? (
          <span className='min-w-0 break-all text-destructive'>
            {delivery.error}
          </span>
        ) : null}
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Ocultar detalhes' : 'Ver detalhes'}
        </Button>
        {canRetry && endpoint ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={retrying}
            onClick={onRetry}
          >
            <SteelIcon icon={RefreshIcon} strokeWidth={2} />
            Reenviar
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className='grid min-w-0 gap-2 md:grid-cols-2'>
          <div className='min-w-0'>
            <span className='text-xs font-medium text-muted-foreground'>
              Corpo enviado · {delivery.eventId}
            </span>
            <pre className='mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-all'>
              {prettyBody(delivery.requestBody)}
            </pre>
          </div>
          <div className='min-w-0'>
            <span className='text-xs font-medium text-muted-foreground'>
              Resposta (até 1 KB)
            </span>
            <pre className='mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-all'>
              {prettyBody(delivery.responseBody) || '—'}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function WebhookDeliveries({
  workspaceId,
  endpoints,
}: {
  workspaceId: string
  endpoints: WebhookEndpointDTO[]
}) {
  const [endpointId, setEndpointId] = useState<string | null>(null)
  const [status, setStatus] = useState<WebhookDeliveryStatusDTO | null>(null)
  const query = useWebhookDeliveries(workspaceId, {
    endpointId: endpointId ?? undefined,
    status: status ?? undefined,
  })
  const { retry } = useWebhookMutations(workspaceId)
  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const items = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entregas</CardTitle>
        <CardDescription>
          Últimos 30 dias. Uma entrega com falha é repetida até 6 vezes, com
          espera crescente; depois, dá para reenviar daqui.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-4'>
        <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
          <Field label='Endpoint'>
            <PlainSelect
              ariaLabel='Filtrar por endpoint'
              placeholder='Todos os endpoints'
              value={endpointId}
              onChange={setEndpointId}
              options={endpoints.map((endpoint) => ({
                value: endpoint.id,
                label: endpoint.description || webhookHost(endpoint.url),
              }))}
            />
          </Field>
          <Field label='Situação'>
            <PlainSelect
              ariaLabel='Filtrar por situação'
              placeholder='Todas'
              value={status}
              onChange={(value) =>
                setStatus(value as WebhookDeliveryStatusDTO | null)
              }
              options={STATUS_OPTIONS}
            />
          </Field>
        </div>
        {endpointId || status ? (
          <div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                setEndpointId(null)
                setStatus(null)
              }}
            >
              Limpar filtros
            </Button>
          </div>
        ) : null}

        {query.isLoading ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-12 w-full' />
            <Skeleton className='h-12 w-full' />
          </div>
        ) : query.isError ? (
          <Muted>{query.error.message}</Muted>
        ) : items.length === 0 ? (
          <Muted>Nenhuma entrega por aqui ainda.</Muted>
        ) : (
          <ul className='flex min-w-0 flex-col'>
            {items.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                delivery={delivery}
                endpoint={byId.get(delivery.endpointId)}
                retrying={retry.isPending && retry.variables === delivery.id}
                onRetry={() =>
                  retry.mutate(delivery.id, {
                    onSuccess: () => notify.success('Reenvio na fila'),
                    onError: (error) => notify.error(error.message),
                  })
                }
              />
            ))}
          </ul>
        )}

        {query.hasNextPage ? (
          <Button
            type='button'
            variant='outline'
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Carregar mais
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
