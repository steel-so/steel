'use client'

import {
  Refresh01Icon,
  UserBlock01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import {
  useSyncWhatsAppContactBlocks,
  useUnblockWhatsAppContact,
  useWhatsAppContactBlocks,
} from '@/src/hooks/use-whatsapp-contact-blocks'
import type {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockSyncDTO,
} from '@/types/whatsapp-contact-block'
import {
  blockContactTitle,
  blockPhoneText,
  formatBlockDate,
  providerLabel,
} from './contact-block-format'
import { WhatsappContactBlockStatusBadge } from './whatsapp-contact-block-status-badge'

const ALL = 'all'

/** pt-BR summary of a sync for the toast. */
export function syncSummary(result: WhatsAppContactBlockSyncDTO): string {
  if (result.connections.length === 0) {
    return 'Nenhum número do WhatsApp conectado para sincronizar.'
  }
  const imported = result.connections.reduce((sum, row) => sum + row.imported, 0)
  const applied = result.connections.reduce((sum, row) => sum + row.applied, 0)
  const parts = [
    imported === 1
      ? '1 bloqueio importado'
      : `${imported} bloqueios importados`,
    applied === 1
      ? '1 aplicado no provedor'
      : `${applied} aplicados no provedor`,
  ]
  const failed = result.connections.filter((row) => row.error)
  const zapiOnly = result.connections.some((row) => !row.listSupported)
  const tail = [
    failed.length > 0
      ? `Não deu para sincronizar ${failed.map((row) => row.label).join(', ')}: ${failed[0].error}`
      : null,
    zapiOnly
      ? 'A Z-API não informa a lista de bloqueados do aparelho; nela só os bloqueios pendentes foram reenviados.'
      : null,
  ].filter(Boolean)
  return [`Sincronizado: ${parts.join(', ')}.`, ...tail].join(' ')
}

function BlockRow({
  block,
  onUnblock,
}: {
  block: WhatsAppContactBlockDTO
  onUnblock: (block: WhatsAppContactBlockDTO) => void
}) {
  const who = block.blockedBy
    ? block.blockedBy.name
    : block.origin === 'PROVIDER'
      ? `Importado da ${providerLabel(block.provider)}`
      : 'Membro removido'
  return (
    <li className='space-y-2 rounded-lg border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>
            {blockContactTitle(block)}
          </p>
          <p className='truncate text-muted-foreground text-xs'>
            {`${blockPhoneText(block)} · número ${block.connectionLabel} (${providerLabel(block.provider)})`}
          </p>
        </div>
        <div className='flex max-w-full flex-wrap items-center gap-1.5'>
          <WhatsappContactBlockStatusBadge block={block} />
        </div>
      </div>
      <dl className='grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3'>
        <div className='min-w-0'>
          <dt className='text-muted-foreground'>Bloqueado por</dt>
          <dd className='truncate'>{`${who} · ${formatBlockDate(block.blockedAt)}`}</dd>
        </div>
        <div className='min-w-0'>
          <dt className='text-muted-foreground'>Mensagens ignoradas</dt>
          <dd className='tabular-nums'>
            {block.droppedCount}
            {block.lastDroppedAt
              ? ` · última em ${formatBlockDate(block.lastDroppedAt)}`
              : ''}
          </dd>
        </div>
        <div className='min-w-0'>
          <dt className='text-muted-foreground'>Motivo</dt>
          <dd className='break-words'>{block.reason ?? 'Não informado'}</dd>
        </div>
      </dl>
      <div className='flex justify-end'>
        <Button size='sm' variant='outline' onClick={() => onUnblock(block)}>
          Desbloquear
        </Button>
      </div>
    </li>
  )
}

/**
 * Comunicação › Configurações › Contatos bloqueados: the blocks of every
 * number, unblock and "Sincronizar com a Meta/Z-API". OWNER/ADMIN and team
 * leaders (the API refuses others).
 */
export function WhatsappBlockedContactsSettings({
  workspaceId,
}: {
  workspaceId: string
}) {
  const blocks = useWhatsAppContactBlocks(workspaceId)
  const unblock = useUnblockWhatsAppContact(workspaceId)
  const sync = useSyncWhatsAppContactBlocks(workspaceId)
  const [connectionId, setConnectionId] = useState<string>(ALL)
  const [confirming, setConfirming] = useState<WhatsAppContactBlockDTO | null>(
    null,
  )

  const numbers = useMemo(() => {
    const seen = new Map<string, string>()
    for (const block of blocks.data ?? []) {
      seen.set(
        block.connectionId,
        `${block.connectionLabel} (${providerLabel(block.provider)})`,
      )
    }
    return [...seen.entries()]
  }, [blocks.data])
  const visible = (blocks.data ?? []).filter(
    (block) => connectionId === ALL || block.connectionId === connectionId,
  )
  const selectedLabel =
    numbers.find(([id]) => id === connectionId)?.[1] ?? 'Todos os números'

  if (blocks.isError && isApiErrorCode(blocks.error, 'FORBIDDEN')) {
    return (
      <p className='text-muted-foreground text-sm'>
        Só administradores e líderes de equipe veem os contatos bloqueados.
      </p>
    )
  }

  async function handleSync() {
    try {
      const result = await sync.mutateAsync(
        connectionId === ALL ? undefined : connectionId,
      )
      const summary = syncSummary(result)
      if (result.connections.some((row) => row.error)) notify.warning(summary)
      else notify.success(summary)
    } catch (error) {
      notify.error(error, 'Não foi possível sincronizar os bloqueios.')
    }
  }

  async function handleUnblock() {
    if (!confirming) return
    try {
      const result = await unblock.mutateAsync(confirming.id)
      if (result.providerWarning) notify.warning(result.providerWarning)
      else notify.success('Contato desbloqueado.')
      setConfirming(null)
    } catch (error) {
      notify.error(error, 'Não foi possível desbloquear o contato.')
    }
  }

  return (
    <section className='space-y-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div className='min-w-0 space-y-1'>
          <p className='font-medium text-sm'>Contatos bloqueados</p>
          <p className='text-muted-foreground text-xs'>
            Mensagens de um contato bloqueado são ignoradas naquele número e
            nada é enviado a ele. A Meta só aceita bloquear quem escreveu nas
            últimas 24 horas; os demais ficam aguardando a pessoa escrever.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {numbers.length > 1 ? (
            <Select
              value={connectionId}
              onValueChange={(value) =>
                setConnectionId((value as string | null) ?? ALL)
              }
            >
              <SelectTrigger
                className='w-full sm:w-56'
                aria-label='Filtrar por número'
              >
                <SelectValue>{selectedLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value={ALL}>Todos os números</SelectItem>
                  {numbers.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          <Button
            size='sm'
            variant='outline'
            disabled={sync.isPending}
            onClick={() => void handleSync()}
          >
            <SteelIcon icon={Refresh01Icon} size={14} />
            {sync.isPending ? 'Sincronizando...' : 'Sincronizar com a Meta/Z-API'}
          </Button>
        </div>
      </div>

      {blocks.isLoading ? (
        <Skeleton className='h-32 w-full rounded-lg' aria-busy />
      ) : blocks.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar os contatos bloqueados agora.
        </p>
      ) : visible.length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center'>
          <SteelIcon
            icon={UserBlock01Icon}
            size={24}
            className='text-muted-foreground'
          />
          <p className='font-medium text-sm'>Nenhum contato bloqueado</p>
          <p className='max-w-sm text-muted-foreground text-xs'>
            Bloqueie pelo menu da conversa ou pelo painel do contato. Para
            trazer bloqueios feitos direto na Meta, use Sincronizar.
          </p>
        </div>
      ) : (
        <ul className='space-y-3'>
          {visible.map((block) => (
            <BlockRow key={block.id} block={block} onUnblock={setConfirming} />
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming
                ? `Desbloquear ${blockContactTitle(confirming)}?`
                : 'Desbloquear contato?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens dessa pessoa voltam a chegar e os envios a ela
              voltam a sair por este número. Se ela estiver bloqueada na Meta
              ou no aparelho da Z-API, o desbloqueio é feito lá também.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unblock.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={unblock.isPending}
              onClick={() => void handleUnblock()}
            >
              {unblock.isPending ? 'Desbloqueando...' : 'Desbloquear'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
