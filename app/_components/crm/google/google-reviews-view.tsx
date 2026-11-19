'use client'

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmGoogleReviews,
  useCrmGoogleReviewsSummary,
  useReconnectOnAuthError,
  useSyncGoogleReviews,
} from '@/src/hooks/use-crm-google-presence'
import type { CrmGoogleConnectionDTO } from '@/src/schemas/crm-google-presence.schema'
import { formatDateTime } from './google-format'
import { GooglePresenceGate } from './google-presence-gate'
import { GoogleReplyToneDialog } from './google-reply-tone-dialog'
import { GoogleRequestReviewDialog } from './google-request-review-dialog'
import { GoogleReviewCard } from './google-review-card'
import { GoogleReviewsSummary } from './google-reviews-summary'

const PAGE_SIZE = 20

type RepliedFilter = 'all' | 'yes' | 'no'

const REPLIED_OPTIONS: { value: RepliedFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'no', label: 'Sem resposta' },
  { value: 'yes', label: 'Respondidas' },
]

/** Avaliações: summary and evolution, filters, the list and the reply flow. */
export function GoogleReviewsView({
  workspaceId,
  connection,
}: {
  workspaceId: string
  connection: CrmGoogleConnectionDTO
}) {
  const [page, setPage] = useState(1)
  const [rating, setRating] = useState<number | undefined>(undefined)
  const [replied, setReplied] = useState<RepliedFilter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [toneOpen, setToneOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const summary = useCrmGoogleReviewsSummary(workspaceId, true)
  const reviews = useCrmGoogleReviews(
    workspaceId,
    {
      page,
      pageSize: PAGE_SIZE,
      rating,
      replied: replied === 'all' ? undefined : replied,
      q: debouncedSearch || undefined,
    },
    true,
  )
  const sync = useSyncGoogleReviews(workspaceId)
  useReconnectOnAuthError(workspaceId, summary.error)

  const businessName = connection.location?.title ?? 'nossa empresa'
  const hasFilters =
    rating !== undefined || replied !== 'all' || debouncedSearch !== ''

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }
  const pickRating = resetPage(setRating)
  const pickReplied = resetPage(setReplied)

  function refresh() {
    sync.mutate(undefined, {
      onSuccess: (result) =>
        notify.success(
          result.created > 0
            ? `${result.created} ${result.created === 1 ? 'avaliação nova' : 'avaliações novas'}.`
            : 'Avaliações em dia.',
        ),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='font-heading font-semibold text-lg tracking-tight'>
            Avaliações
          </h3>
          <p className='text-muted-foreground text-xs'>
            {connection.lastReviewsSyncAt
              ? `Sincronizado em ${formatDateTime(connection.lastReviewsSyncAt)}. O Steel atualiza a cada 30 minutos.`
              : 'Ainda não sincronizado.'}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button variant='ghost' size='sm' onClick={() => setToneOpen(true)}>
            Tom de voz da IA
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={sync.isPending}
            onClick={refresh}
          >
            <SteelIcon
              icon={RefreshIcon}
              size={14}
              className={cn(sync.isPending && 'animate-spin')}
            />
            {sync.isPending ? 'Atualizando…' : 'Atualizar agora'}
          </Button>
          <Button size='sm' onClick={() => setRequestOpen(true)}>
            <SteelIcon icon={StarIcon} size={14} />
            Pedir avaliação
          </Button>
        </div>
      </div>

      {summary.isLoading ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <Skeleton className='h-60' />
          <Skeleton className='h-60' />
        </div>
      ) : summary.data ? (
        <GoogleReviewsSummary
          summary={summary.data}
          activeRating={rating}
          onPickRating={pickRating}
        />
      ) : null}

      <div className='flex flex-wrap items-center gap-2'>
        <fieldset className='inline-flex min-w-0 rounded-lg border border-border/70 p-0.5'>
          <legend className='sr-only'>Filtrar por resposta</legend>
          {REPLIED_OPTIONS.map((option) => (
            <button
              key={option.value}
              type='button'
              aria-pressed={replied === option.value}
              onClick={() => pickReplied(option.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                replied === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <fieldset className='inline-flex min-w-0 rounded-lg border border-border/70 p-0.5'>
          <legend className='sr-only'>Filtrar por nota</legend>
          {[5, 4, 3, 2, 1].map((stars) => (
            <button
              key={stars}
              type='button'
              aria-pressed={rating === stars}
              aria-label={`${stars} estrelas`}
              onClick={() => pickRating(rating === stars ? undefined : stars)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm transition-colors',
                rating === stars
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {stars}
              <SteelIcon icon={StarIcon} size={12} />
            </button>
          ))}
        </fieldset>
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder='Buscar no texto ou no nome…'
          aria-label='Buscar avaliações'
          className='h-9 w-full sm:w-64'
        />
        {hasFilters ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              setRating(undefined)
              setReplied('all')
              setSearch('')
              setPage(1)
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {reviews.isLoading ? (
        <div className='space-y-3'>
          <Skeleton className='h-28 w-full' />
          <Skeleton className='h-28 w-full' />
          <Skeleton className='h-28 w-full' />
        </div>
      ) : reviews.error ? (
        <div className='space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p role='alert' className='text-destructive text-sm'>
            {reviews.error.message}
          </p>
          <Button variant='outline' size='sm' onClick={() => reviews.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (reviews.data?.items ?? []).length === 0 ? (
        <p className='rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm'>
          {hasFilters
            ? 'Nenhuma avaliação com esses filtros.'
            : 'Ainda não há avaliações neste local. Peça a primeira aos seus clientes.'}
        </p>
      ) : (
        <>
          <ul
            className={cn(
              'space-y-3',
              reviews.isPlaceholderData && 'opacity-60',
            )}
          >
            {(reviews.data?.items ?? []).map((review) => (
              <li key={review.id}>
                <GoogleReviewCard workspaceId={workspaceId} review={review} />
              </li>
            ))}
          </ul>
          {(reviews.data?.totalPages ?? 1) > 1 ? (
            <nav
              aria-label='Paginação das avaliações'
              className='flex items-center justify-between gap-3'
            >
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <SteelIcon icon={ArrowLeft01Icon} size={14} />
                Anterior
              </Button>
              <span className='text-muted-foreground text-sm'>
                Página {reviews.data?.page} de {reviews.data?.totalPages} ·{' '}
                {reviews.data?.total} avaliações
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= (reviews.data?.totalPages ?? 1)}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
                <SteelIcon icon={ArrowRight01Icon} size={14} />
              </Button>
            </nav>
          ) : null}
        </>
      )}

      <GoogleRequestReviewDialog
        workspaceId={workspaceId}
        businessName={businessName}
        open={requestOpen}
        onOpenChange={setRequestOpen}
      />
      {toneOpen ? (
        <GoogleReplyToneDialog
          workspaceId={workspaceId}
          currentTone={connection.replyTone}
          open={toneOpen}
          onOpenChange={setToneOpen}
        />
      ) : null}
    </div>
  )
}

/** Page body of CRM > Presença no Google > Avaliações. */
export function GoogleReviewsScreen({
  workspaceId,
  failureReason,
}: {
  workspaceId: string
  failureReason: string | null
}) {
  return (
    <GooglePresenceGate workspaceId={workspaceId} failureReason={failureReason}>
      {(connection) => (
        <GoogleReviewsView workspaceId={workspaceId} connection={connection} />
      )}
    </GooglePresenceGate>
  )
}
