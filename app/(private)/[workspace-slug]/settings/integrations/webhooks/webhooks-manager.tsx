'use client'

import {
  Add01Icon,
  Alert02Icon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useWebhookEndpoints,
  useWebhookMutations,
} from '@/src/hooks/use-webhooks'
import { WEBHOOK_ENDPOINT_LIMIT } from '@/src/schemas/webhook.schema'
import type { WebhookEndpointDTO } from '@/types/webhook'
import { formatIntegrationDate } from '../integration-kit'
import { WebhookDeliveries } from './webhook-deliveries'
import {
  WebhookEndpointDialog,
  type WebhookEndpointFormValue,
} from './webhook-endpoint-dialog'
import { webhookEventsSummary, webhookHost } from './webhook-format'
import { WebhookSecretDialog } from './webhook-secret-dialog'

/**
 * Ajustes › Webhooks (ADR 0036): endpoints (URL, events,
 * active), the signing secret (shown on create, rotate and reveal), the test
 * ping and the delivery log with re-delivery.
 */

type SecretView = { secret: string; title: string; description: string }
type Confirm = { kind: 'rotate' | 'delete'; endpoint: WebhookEndpointDTO }

function EndpointStatus({ endpoint }: { endpoint: WebhookEndpointDTO }) {
  if (!endpoint.active) {
    return endpoint.disabledReason === 'auto' ? (
      <Badge variant='destructive' className='gap-1'>
        <SteelIcon icon={Alert02Icon} strokeWidth={2} className='size-3' />
        Desativado por falhas
      </Badge>
    ) : (
      <Badge variant='secondary'>Desativado</Badge>
    )
  }
  if (endpoint.failingSince) {
    return (
      <Badge variant='destructive' className='gap-1'>
        <SteelIcon icon={Alert02Icon} strokeWidth={2} className='size-3' />
        Falhando
      </Badge>
    )
  }
  return <Badge variant='default'>Ativo</Badge>
}

function EndpointCard({
  workspaceId,
  endpoint,
  onEdit,
  onSecret,
  onConfirm,
}: {
  workspaceId: string
  endpoint: WebhookEndpointDTO
  onEdit: () => void
  onSecret: (view: SecretView) => void
  onConfirm: (confirm: Confirm) => void
}) {
  const { update, test, reveal } = useWebhookMutations(workspaceId)
  const lastSuccess = formatIntegrationDate(endpoint.lastSuccessAt)
  const failingSince = formatIntegrationDate(endpoint.failingSince)

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='min-w-0 break-all'>
            {endpoint.description || webhookHost(endpoint.url)}
          </span>
          <EndpointStatus endpoint={endpoint} />
        </CardTitle>
        <CardDescription className='break-all font-mono text-xs'>
          {endpoint.url}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-1 text-xs text-muted-foreground'>
        <span>
          {webhookEventsSummary(endpoint.events)} · segredo{' '}
          <code>{endpoint.secretHint}</code>
        </span>
        <span>
          Última entrega com sucesso: {lastSuccess ?? 'nenhuma ainda'}
        </span>
        {failingSince ? (
          <span className='text-destructive'>
            Falhando desde {failingSince}. Depois de 3 dias seguidos o endpoint
            é desativado e os administradores são avisados.
          </span>
        ) : null}
      </CardContent>
      <CardFooter className='flex flex-wrap items-center gap-2'>
        <div className='mr-auto flex items-center gap-2 text-sm'>
          <Switch
            checked={endpoint.active}
            disabled={update.isPending}
            aria-label='Ativo'
            onCheckedChange={(active) =>
              update.mutate(
                { id: endpoint.id, dto: { active } },
                {
                  onSuccess: () =>
                    notify.success(
                      active ? 'Webhook reativado' : 'Webhook desativado',
                    ),
                  onError: (error) => notify.error(error.message),
                },
              )
            }
          />
          <span aria-hidden>Ativo</span>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={test.isPending}
          onClick={() =>
            test.mutate(endpoint.id, {
              onSuccess: (delivery) =>
                delivery.status === 'SUCCEEDED'
                  ? notify.success(
                      `Teste entregue (HTTP ${delivery.responseStatus ?? '—'})`,
                    )
                  : notify.error(
                      `O teste falhou: ${delivery.error ?? 'sem resposta'}`,
                    ),
              onError: (error) => notify.error(error.message),
            })
          }
        >
          <SteelIcon icon={SentIcon} strokeWidth={2} />
          Enviar teste
        </Button>
        <Button type='button' variant='outline' size='sm' onClick={onEdit}>
          Editar
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={reveal.isPending}
          onClick={() =>
            reveal.mutate(endpoint.id, {
              onSuccess: ({ secret }) =>
                onSecret({
                  secret,
                  title: 'Segredo de assinatura',
                  description:
                    'Use este valor no seu sistema para conferir as assinaturas. Não compartilhe.',
                }),
              onError: (error) => notify.error(error.message),
            })
          }
        >
          Revelar segredo
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => onConfirm({ kind: 'rotate', endpoint })}
        >
          Trocar segredo
        </Button>
        <Button
          type='button'
          variant='destructive'
          size='sm'
          onClick={() => onConfirm({ kind: 'delete', endpoint })}
        >
          Remover
        </Button>
      </CardFooter>
    </Card>
  )
}

export function WebhooksManager({ workspaceId }: { workspaceId: string }) {
  const endpoints = useWebhookEndpoints(workspaceId)
  const { create, update, rotate, remove } = useWebhookMutations(workspaceId)
  const [editing, setEditing] = useState<WebhookEndpointDTO | 'new' | null>(
    null,
  )
  const [secret, setSecret] = useState<SecretView | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const items = endpoints.data?.items ?? []
  const full = items.length >= WEBHOOK_ENDPOINT_LIMIT

  const save = (value: WebhookEndpointFormValue) => {
    if (editing === 'new') {
      create.mutate(
        {
          url: value.url,
          description: value.description || undefined,
          events: value.events,
        },
        {
          onSuccess: (created) => {
            setEditing(null)
            setSecret({
              secret: created.secret,
              title: 'Webhook cadastrado',
              description:
                'Guarde o segredo de assinatura no seu sistema. Você pode revelá-lo de novo depois, nesta tela.',
            })
          },
          onError: (error) => notify.error(error.message),
        },
      )
      return
    }
    if (!editing) return
    update.mutate(
      {
        id: editing.id,
        dto: {
          url: value.url,
          description: value.description || null,
          events: value.events,
        },
      },
      {
        onSuccess: () => {
          setEditing(null)
          notify.success('Webhook salvo')
        },
        onError: (error) => notify.error(error.message),
      },
    )
  }

  const runConfirm = () => {
    if (!confirm) return
    const { kind, endpoint } = confirm
    setConfirm(null)
    if (kind === 'delete') {
      remove.mutate(endpoint.id, {
        onSuccess: () => notify.success('Webhook removido'),
        onError: (error) => notify.error(error.message),
      })
      return
    }
    rotate.mutate(endpoint.id, {
      onSuccess: (rotated) =>
        setSecret({
          secret: rotated.secret,
          title: 'Segredo trocado',
          description:
            'O segredo antigo deixou de valer. Atualize o seu sistema agora para as próximas entregas serem aceitas.',
        }),
      onError: (error) => notify.error(error.message),
    })
  }

  return (
    <div className='flex min-w-0 flex-col gap-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Muted className='text-xs'>
          {items.length} de {WEBHOOK_ENDPOINT_LIMIT} endpoints
        </Muted>
        <Button
          type='button'
          disabled={full || endpoints.isLoading}
          onClick={() => setEditing('new')}
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Novo webhook
        </Button>
      </div>

      {endpoints.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-32 w-full' />
          <Skeleton className='h-32 w-full' />
        </div>
      ) : endpoints.isError ? (
        <Muted>{endpoints.error.message}</Muted>
      ) : items.length === 0 ? (
        <Card size='sm'>
          <CardContent className='flex flex-col gap-2'>
            <span className='font-medium'>Nenhum webhook cadastrado</span>
            <Muted className='text-sm'>
              Cadastre a URL do seu sistema e escolha os eventos. Para testar na
              sua máquina, use o <code>steel listen</code> do Steel CLI.
            </Muted>
          </CardContent>
        </Card>
      ) : (
        <div className='flex flex-col gap-3'>
          {items.map((endpoint) => (
            <EndpointCard
              key={endpoint.id}
              workspaceId={workspaceId}
              endpoint={endpoint}
              onEdit={() => setEditing(endpoint)}
              onSecret={setSecret}
              onConfirm={setConfirm}
            />
          ))}
        </div>
      )}

      <WebhookDeliveries workspaceId={workspaceId} endpoints={items} />

      {editing !== null ? (
        <WebhookEndpointDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          endpoint={editing === 'new' ? null : editing}
          pending={create.isPending || update.isPending}
          onSubmit={save}
        />
      ) : null}

      <WebhookSecretDialog
        secret={secret?.secret ?? null}
        title={secret?.title ?? ''}
        description={secret?.description ?? ''}
        onClose={() => setSecret(null)}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'delete'
                ? 'Remover este webhook?'
                : 'Trocar o segredo?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'delete'
                ? 'O Steel para de enviar eventos para esta URL na hora. As entregas pendentes são descartadas.'
                : 'O segredo atual deixa de valer imediatamente: as próximas entregas saem assinadas com o novo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
              onClick={runConfirm}
            >
              {confirm?.kind === 'delete' ? 'Remover' : 'Trocar segredo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
