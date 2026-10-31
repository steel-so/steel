'use client'

import { useState } from 'react'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { type QaReviewsParams, useQaReviews } from '@/src/hooks/use-qa-review'
import {
  formatQaDate,
  QA_HANDLER_LABEL,
  QA_STATUS_LABEL,
  QA_SUBJECT_LABEL,
  qaSkipReasonLabel,
} from './qa-format'
import { QaReviewDialog } from './qa-review-dialog'
import { QaScoreBadge } from './qa-score-badge'

const ALL = 'ALL'

/** Every review, newest first, with filters and the detail dialog. */
export function QaReviewsList({
  workspaceId,
  initialReviewId = null,
}: {
  workspaceId: string
  initialReviewId?: string | null
}) {
  const [subjectType, setSubjectType] = useState<string>(ALL)
  const [status, setStatus] = useState<string>(ALL)
  const [lowOnly, setLowOnly] = useState(false)
  const [cursors, setCursors] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(initialReviewId)

  const params: QaReviewsParams = {
    subjectType:
      subjectType === ALL ? undefined : (subjectType as 'TICKET' | 'CONVERSATION'),
    status: status === ALL ? undefined : (status as QaReviewsParams['status']),
    lowOnly,
    cursor: cursors[cursors.length - 1],
  }
  const reviews = useQaReviews(workspaceId, params)
  const resetPage = () => setCursors([])
  const items = reviews.data?.items ?? []
  const nextCursor = reviews.data?.nextCursor ?? null

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select
          value={subjectType}
          onValueChange={(value) => {
            setSubjectType(value ?? ALL)
            resetPage()
          }}
        >
          <SelectTrigger className='w-44' aria-label='Tipo de atendimento'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              <SelectItem value='CONVERSATION'>
                {QA_SUBJECT_LABEL.CONVERSATION}
              </SelectItem>
              <SelectItem value='TICKET'>{QA_SUBJECT_LABEL.TICKET}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value ?? ALL)
            resetPage()
          }}
        >
          <SelectTrigger className='w-44' aria-label='Situação'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Todas as situações</SelectItem>
              {(Object.keys(QA_STATUS_LABEL) as (keyof typeof QA_STATUS_LABEL)[]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {QA_STATUS_LABEL[key]}
                  </SelectItem>
                ),
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className='flex items-center gap-2'>
          <Switch
            id='qa-low-only'
            checked={lowOnly}
            onCheckedChange={(checked) => {
              setLowOnly(checked)
              resetPage()
            }}
          />
          <Label htmlFor='qa-low-only'>Só notas baixas</Label>
        </div>
      </div>

      {reviews.isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
        </div>
      ) : reviews.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar as avaliações.
        </p>
      ) : items.length === 0 ? (
        <EmptyState>Nenhuma avaliação com esses filtros.</EmptyState>
      ) : (
        <ul className='grid gap-2'>
          {items.map((review) => (
            <li key={review.id}>
              <button
                type='button'
                onClick={() => setOpenId(review.id)}
                className='flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50'
              >
                <QaScoreBadge score={review.score} lowScore={review.lowScore} />
                <span className='min-w-0 flex-1 truncate text-sm'>
                  {review.subjectLabel ?? QA_SUBJECT_LABEL[review.subjectType]}
                  {review.customerName ? ` · ${review.customerName}` : ''}
                </span>
                {review.handlerKind ? (
                  <Badge variant='outline'>
                    {QA_HANDLER_LABEL[review.handlerKind]}
                  </Badge>
                ) : null}
                <span className='text-muted-foreground text-xs'>
                  {review.agentName ?? 'Sem responsável'}
                </span>
                <span className='w-full text-muted-foreground text-xs sm:w-auto'>
                  {review.status === 'COMPLETED'
                    ? formatQaDate(review.reviewedAt)
                    : `${QA_STATUS_LABEL[review.status]} · ${qaSkipReasonLabel(review.skipReason)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className='flex justify-between'>
        <Button
          variant='outline'
          size='sm'
          disabled={cursors.length === 0}
          onClick={() => setCursors((list) => list.slice(0, -1))}
        >
          Anterior
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={!nextCursor}
          onClick={() => nextCursor && setCursors((list) => [...list, nextCursor])}
        >
          Próxima
        </Button>
      </div>

      <QaReviewDialog
        workspaceId={workspaceId}
        reviewId={openId}
        onClose={() => setOpenId(null)}
      />
    </div>
  )
}
