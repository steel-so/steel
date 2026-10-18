'use client'

import {
  AiMagicIcon,
  ArrowRight01Icon,
  Clock01Icon,
  Loading03Icon,
  PlugSocketIcon,
  RoboticIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
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
import { isApiErrorCode } from '@/src/hooks/_fetch'
import { useDecideInboxAiPending } from '@/src/hooks/use-notifications'
import type { InboxAiPendingItemDTO } from '@/types/notification'
import type { AiActionKindDTO } from '@/types/steel-ai'

const KIND_LABEL: Record<AiActionKindDTO, string> = {
  CREATE: 'Criar',
  UPDATE: 'Alterar',
  DELETE: 'Excluir',
  ACTION: 'Ação',
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "expira em 4 min" / "expira em 2 h" / "expira em 3 dias" / "expirada". */
export function expiryLabel(expiresAt: string, now: number): string {
  const left = Date.parse(expiresAt) - now
  if (left <= 0) return 'Expirada'
  if (left < MINUTE) return 'Expira em menos de 1 min'
  if (left < HOUR) return `Expira em ${Math.ceil(left / MINUTE)} min`
  if (left < DAY) return `Expira em ${Math.floor(left / HOUR)} h`
  const days = Math.floor(left / DAY)
  return `Expira em ${days} ${days === 1 ? 'dia' : 'dias'}`
}

/** Less than 5 minutes left: the countdown turns into a warning. */
export function isExpiringSoon(expiresAt: string, now: number): boolean {
  const left = Date.parse(expiresAt) - now
  return left > 0 && left <= 5 * MINUTE
}

/**
 * One "Pendências da IA" item: the preview (before → after), where it came
 * from (chat, agent run or a connected app over MCP), the expiry countdown
 * and the inline decision. Assistant and MCP items say Confirmar/Cancelar
 * (only the requester sees them); agent items say Aprovar/Rejeitar.
 * Exclusion asks twice and sends `doubleConfirmed: true` — the server
 * checks it again either way. `highlighted` is the action an MCP confirm
 * link points at (`?action=<id>`): scrolled into view and outlined.
 */
export function NotificationAiPendingCard({
  workspaceId,
  slug,
  item,
  now,
  highlighted = false,
}: {
  workspaceId: string
  slug: string
  item: InboxAiPendingItemDTO
  /** Shared clock (ms) so every countdown ticks together. */
  now: number
  highlighted?: boolean
}) {
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (highlighted) {
      cardRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    }
  }, [highlighted])
  const decide = useDecideInboxAiPending(workspaceId)
  const [askTwice, setAskTwice] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<
    'positive' | 'negative' | null
  >(null)
  const { action } = item
  const { preview } = action
  const isAgent = item.source === 'AGENT'
  const client = item.client
  const isDelete = action.kind === 'DELETE' || action.requiresDoubleConfirm
  const expired = Date.parse(action.expiresAt) <= now
  const soon = isExpiringSoon(action.expiresAt, now)
  const busy = decide.isPending

  const positiveLabel = isAgent ? 'Aprovar' : 'Confirmar'
  const negativeLabel = isAgent ? 'Rejeitar' : 'Cancelar'

  async function run(positive: boolean, doubleConfirmed = false) {
    setPendingDecision(positive ? 'positive' : 'negative')
    try {
      const result = await decide.mutateAsync(
        isAgent
          ? {
              source: 'AGENT',
              runId: item.runId ?? '',
              decision: positive ? 'approve' : 'reject',
              actionId: action.id,
              doubleConfirmed,
            }
          : {
              source: 'ASSISTANT',
              decision: positive ? 'confirm' : 'cancel',
              actionId: action.id,
              doubleConfirmed,
            },
      )
      setAskTwice(false)
      if (!positive) {
        notify.success(isAgent ? 'Ação rejeitada' : 'Ação cancelada')
      } else if (result.status === 'FAILED') {
        notify.error(result.error ?? 'A ação falhou ao executar')
      } else {
        notify.success(result.resultSummary ?? 'Ação executada')
      }
    } catch (error) {
      setAskTwice(false)
      if (isApiErrorCode(error, 'AI_PENDING_ACTION_CHANGED')) {
        // Still pending: the list refetch brings the fresh preview.
        notify.warning(
          'O registro mudou desde a prévia. Revise e confirme de novo.',
        )
        return
      }
      notify.error(error, 'Não foi possível decidir a ação')
    } finally {
      setPendingDecision(null)
    }
  }

  const sourceLabel = isAgent
    ? (item.agent?.name ?? 'Steel Agent')
    : client
      ? (client.name ?? 'App conectado')
      : (item.conversation?.title ?? 'Conversa com o Steel AI')
  const originLabel = isAgent ? 'Agente' : client ? 'App conectado' : 'Steel AI'
  const originIcon = isAgent
    ? RoboticIcon
    : client
      ? PlugSocketIcon
      : AiMagicIcon

  return (
    <article
      ref={cardRef}
      aria-label={`Pendência da IA: ${preview.title}`}
      aria-current={highlighted ? 'true' : undefined}
      data-source={client ? 'MCP' : item.source}
      className={cn(
        'space-y-3 rounded-xl border bg-card p-3.5 text-card-foreground',
        isDelete ? 'border-destructive/40' : 'border-border/80',
        highlighted && 'ring-2 ring-primary/60',
      )}
    >
      <header className='space-y-1.5'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          <Badge
            variant={action.kind === 'DELETE' ? 'destructive' : 'secondary'}
          >
            {KIND_LABEL[action.kind]}
          </Badge>
          <span className='inline-flex min-w-0 items-center gap-1 text-muted-foreground'>
            <SteelIcon
              icon={originIcon}
              strokeWidth={2}
              className='size-3.5 shrink-0'
            />
            <span className='truncate'>
              {originLabel} · {sourceLabel}
            </span>
          </span>
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1',
              soon || expired
                ? 'font-medium text-destructive'
                : 'text-muted-foreground',
            )}
            title={new Date(action.expiresAt).toLocaleString('pt-BR')}
          >
            <SteelIcon
              icon={Clock01Icon}
              strokeWidth={2}
              className='size-3.5'
            />
            {expiryLabel(action.expiresAt, now)}
          </span>
        </div>
        <h3 className='font-semibold text-sm leading-snug'>{preview.title}</h3>
        {preview.summary ? (
          <p className='text-muted-foreground text-xs'>{preview.summary}</p>
        ) : null}
        {client ? (
          <p className='text-muted-foreground text-xs'>
            Pedido por {client.name ?? 'um app conectado'} em seu nome, via MCP.
            Nada foi feito ainda: confirme só se reconhece o pedido.
          </p>
        ) : null}
      </header>

      {preview.fields && preview.fields.length > 0 ? (
        <dl className='space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-xs'>
          {preview.fields.map((field) => (
            <div
              key={field.label}
              className='grid grid-cols-[minmax(5rem,auto)_1fr] gap-2'
            >
              <dt className='text-muted-foreground'>{field.label}</dt>
              <dd className='flex min-w-0 flex-wrap items-center gap-1'>
                {field.before !== undefined ? (
                  <>
                    <span className='break-words text-muted-foreground line-through'>
                      {field.before || '—'}
                    </span>
                    <SteelIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className='size-3 shrink-0 text-muted-foreground'
                      aria-label='para'
                    />
                  </>
                ) : null}
                <span className='break-words font-medium'>
                  {field.after || '—'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <footer className='flex flex-wrap items-center gap-2'>
        {client ? null : (
          <Link
            href={`/${slug}${item.path}`}
            className='text-primary text-xs hover:underline'
          >
            {isAgent ? 'Ver execução do agente' : 'Abrir conversa'}
          </Link>
        )}
        <div className='ml-auto flex items-center gap-2'>
          <Button
            size='xs'
            variant='outline'
            disabled={busy || expired}
            onClick={() => run(false)}
          >
            {pendingDecision === 'negative' ? (
              <SteelIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className='animate-spin'
              />
            ) : null}
            {negativeLabel}
          </Button>
          <Button
            size='xs'
            variant={isDelete ? 'destructive' : 'default'}
            disabled={busy || expired}
            onClick={() => (isDelete ? setAskTwice(true) : run(true))}
          >
            {pendingDecision === 'positive' ? (
              <SteelIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className='animate-spin'
              />
            ) : null}
            {pendingDecision === 'positive' ? 'Executando…' : positiveLabel}
          </Button>
        </div>
      </footer>

      <AlertDialog
        open={askTwice}
        onOpenChange={(open) => {
          if (!open && !busy) setAskTwice(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isAgent ? 'Aprovar exclusão?' : 'Confirmar exclusão?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preview.title}. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={busy}
              onClick={() => run(true, true)}
            >
              Excluir definitivamente
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
