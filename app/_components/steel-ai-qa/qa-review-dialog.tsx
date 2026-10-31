'use client'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useQaReview } from '@/src/hooks/use-qa-review'
import {
  formatQaDate,
  QA_HANDLER_LABEL,
  QA_SUBJECT_LABEL,
  qaSkipReasonLabel,
} from './qa-format'
import { QaScoreBadge } from './qa-score-badge'

/** One review in detail: score per criterion with the evidence and the tips. */
export function QaReviewDialog({
  workspaceId,
  reviewId,
  onClose,
}: {
  workspaceId: string
  reviewId: string | null
  onClose: () => void
}) {
  const review = useQaReview(workspaceId, reviewId)
  const data = review.data

  return (
    <Dialog open={!!reviewId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Avaliação do atendimento</DialogTitle>
          <DialogDescription>
            {data
              ? `${QA_SUBJECT_LABEL[data.subjectType]}${data.subjectLabel ? ` · ${data.subjectLabel}` : ''}`
              : 'Carregando…'}
          </DialogDescription>
        </DialogHeader>
        {review.isLoading ? (
          <Skeleton className='h-40 w-full' />
        ) : review.isError || !data ? (
          <p className='text-destructive text-sm'>
            Não foi possível carregar a avaliação.
          </p>
        ) : (
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <QaScoreBadge score={data.score} lowScore={data.lowScore} />
              {data.handlerKind ? (
                <Badge variant='outline'>
                  {QA_HANDLER_LABEL[data.handlerKind]}
                </Badge>
              ) : null}
              <span className='text-muted-foreground'>
                {data.agentName ?? 'Sem responsável humano'}
                {data.customerName ? ` · cliente ${data.customerName}` : ''}
              </span>
              <span className='ml-auto text-muted-foreground text-xs'>
                {formatQaDate(data.reviewedAt)}
              </span>
            </div>

            {data.status !== 'COMPLETED' ? (
              <p className='text-muted-foreground text-sm'>
                {qaSkipReasonLabel(data.skipReason)}
              </p>
            ) : null}

            {data.summary ? <p className='text-sm'>{data.summary}</p> : null}

            {data.criteriaResults.length > 0 ? (
              <ul className='space-y-2'>
                {data.criteriaResults.map((result) => (
                  <li
                    key={result.key}
                    className='rounded-lg border bg-card px-3 py-2'
                  >
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-sm'>{result.name}</span>
                      <span className='text-muted-foreground text-xs'>
                        peso {result.weight}
                      </span>
                      <QaScoreBadge
                        score={result.score}
                        className='ml-auto'
                      />
                    </div>
                    {result.evidence ? (
                      <p className='mt-1 text-muted-foreground text-xs'>
                        “{result.evidence}”
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {data.coachingTips.length > 0 ? (
              <div className='space-y-1'>
                <h3 className='font-medium text-sm'>Dicas para o atendente</h3>
                <ul className='list-disc space-y-1 pl-5 text-sm'>
                  {data.coachingTips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
