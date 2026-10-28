'use client'

import { Add01Icon, Mail01Icon } from '@hugeicons-pro/core-stroke-rounded'
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
  useSendingDomain,
  useSendingDomainMutations,
  useSendingDomains,
} from '@/src/hooks/use-sending-domains'
import type { SendingDomainDTO } from '@/src/schemas/sending-domain.schema'
import { AddSendingDomainDialog } from './add-sending-domain-dialog'
import { SendingDomainDetail } from './sending-domain-detail'
import { DOMAIN_STATUS, formatDomainDate } from './sending-domain-format'
import { StatusBadge } from './sending-domain-status-badge'

/**
 * Ajustes › Domínios de e-mail (ADR 0054): the workspace's own domains for
 * sending newsletters. List with status, add, and the selected domain's
 * DNS records, DMARC hint, "Verificar agora" and remove.
 */

function newslettersLabel(count: number): string {
  if (count === 0) return 'Nenhuma newsletter usa este domínio'
  return count === 1
    ? '1 newsletter ativa usa este domínio'
    : `${count} newsletters ativas usam este domínio`
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card size='sm'>
      <CardContent className='flex flex-col items-start gap-3'>
        <SteelIcon
          icon={Mail01Icon}
          strokeWidth={2}
          className='size-6 text-primary'
        />
        <span className='font-medium'>Nenhum domínio cadastrado</span>
        <Muted className='text-sm'>
          Para enviar newsletters com o nome da sua empresa no remetente (por
          exemplo, novidades@news.suaempresa.com.br), cadastre um domínio e
          publique os registros DNS que o Steel mostrar. Se você não cuida do
          site da empresa, peça ajuda a quem cuida: leva uns 10 minutos.
        </Muted>
        <Button type='button' onClick={onAdd}>
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Adicionar domínio
        </Button>
      </CardContent>
    </Card>
  )
}

function DomainCard({
  workspaceId,
  domain,
  selected,
  onToggle,
  onRemove,
}: {
  workspaceId: string
  domain: SendingDomainDTO
  selected: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const status = DOMAIN_STATUS[domain.status]
  const detail = useSendingDomain(workspaceId, selected ? domain.id : null)
  const { verify, remove } = useSendingDomainMutations(workspaceId)
  const lastChecked = formatDomainDate(domain.lastCheckedAt)

  return (
    <Card size='sm' data-domain-id={domain.id}>
      <CardHeader>
        <CardTitle className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='min-w-0 break-all'>{domain.name}</span>
          <StatusBadge label={status.label} tone={status.tone} />
        </CardTitle>
        <CardDescription className='flex flex-col gap-0.5 text-xs'>
          <span>{newslettersLabel(domain.newslettersCount)}</span>
          <span>Última verificação: {lastChecked ?? 'nunca'}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-4'>
        <div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            aria-expanded={selected}
            onClick={onToggle}
          >
            {selected ? 'Ocultar registros DNS' : 'Ver registros DNS'}
          </Button>
        </div>
        {selected ? (
          <SendingDomainDetail
            domain={detail.data}
            loading={detail.isLoading}
            verifying={verify.isPending}
            removing={remove.isPending}
            onVerify={() =>
              verify.mutate(domain.id, {
                onSuccess: (updated) =>
                  updated.status === 'VERIFIED'
                    ? notify.success('Domínio verificado')
                    : notify.info(
                        `Verificação feita: ${DOMAIN_STATUS[updated.status].label.toLowerCase()}`,
                      ),
                onError: (error) => notify.error(error.message),
              })
            }
            onRemove={onRemove}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

export function EmailDomainsManager({
  workspaceId,
  initialDomainId,
}: {
  workspaceId: string
  /** `?domain=<id>` (links from the inbox notices) opens that domain. */
  initialDomainId?: string | null
}) {
  const domains = useSendingDomains(workspaceId)
  const { create, remove } = useSendingDomainMutations(workspaceId)
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDomainId ?? null,
  )
  const [confirm, setConfirm] = useState<SendingDomainDTO | null>(null)

  const items = domains.data ?? []

  const runRemove = () => {
    if (!confirm) return
    const target = confirm
    setConfirm(null)
    remove.mutate(target.id, {
      onSuccess: () => {
        if (selectedId === target.id) setSelectedId(null)
        notify.success('Domínio removido')
      },
      onError: (error) => notify.error(error.message),
    })
  }

  return (
    <div className='flex min-w-0 flex-col gap-6'>
      {items.length > 0 ? (
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <Muted className='text-xs'>
            {items.length === 1 ? '1 domínio' : `${items.length} domínios`}
          </Muted>
          <Button type='button' onClick={() => setAdding(true)}>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar domínio
          </Button>
        </div>
      ) : null}

      {domains.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-24 w-full' />
        </div>
      ) : domains.isError ? (
        <Muted>{domains.error.message}</Muted>
      ) : items.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : (
        <div className='flex flex-col gap-3'>
          {items.map((domain) => (
            <DomainCard
              key={domain.id}
              workspaceId={workspaceId}
              domain={domain}
              selected={selectedId === domain.id}
              onToggle={() =>
                setSelectedId((current) =>
                  current === domain.id ? null : domain.id,
                )
              }
              onRemove={() => setConfirm(domain)}
            />
          ))}
        </div>
      )}

      <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
        <span className='font-medium text-foreground'>Como funciona</span>
        <span>
          1. Adicione o domínio (de preferência um subdomínio, como
          news.suaempresa.com.br).
        </span>
        <span>
          2. Copie os registros DNS e crie cada um no painel do seu domínio.
        </span>
        <span>
          3. Clique em "Verificar agora". Quando aparecer "Verificado", escolha
          um remetente desse domínio na newsletter (CRM › Newsletters).
        </span>
      </div>

      {adding ? (
        <AddSendingDomainDialog
          open
          onOpenChange={(open) => !open && setAdding(false)}
          pending={create.isPending}
          onSubmit={(value) =>
            create.mutate(value, {
              onSuccess: (created) => {
                setAdding(false)
                setSelectedId(created.id)
                notify.success(
                  'Domínio adicionado. Agora publique os registros DNS.',
                )
              },
              onError: (error) => notify.error(error.message),
            })
          }
        />
      ) : null}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && confirm.newslettersCount > 0
                ? 'Há newsletters ativas enviando deste domínio. Troque o remetente delas (ou arquive-as) antes de remover.'
                : 'O domínio deixa de poder enviar newsletters. Os registros DNS podem ser apagados depois. Para usar de novo, será preciso cadastrar e verificar outra vez.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={runRemove}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
