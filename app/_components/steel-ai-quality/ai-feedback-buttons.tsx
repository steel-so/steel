'use client'

import {
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  feedbackKey,
  useMyAiFeedback,
  useRateAiAnswer,
  useRemoveAiFeedback,
} from '@/src/hooks/use-ai-feedback'
import {
  AI_FEEDBACK_REASON_LABELS,
  AI_FEEDBACK_REASONS,
  type AiFeedbackReason,
  type AiFeedbackSurfaceKey,
} from '@/src/lib/ai/quality-labels'
import type { AiFeedbackDTO } from '@/types/ai-quality'

const COMMENT_MAX = 1000

export interface AiFeedbackButtonsProps {
  workspaceId: string
  surface: AiFeedbackSurfaceKey
  targetId: string
  /** Sub-answer (ServiceDesk copilot only). */
  variant?: string
  /** The caller's current rating; `undefined` while it loads. */
  feedback: AiFeedbackDTO | null | undefined
  /** Shown before the buttons (e.g. "Esta resposta ajudou?"). */
  label?: string
  className?: string
}

/**
 * 👍/👎 under an AI answer (ADR 0039). Thumbs up toggles; thumbs down opens
 * an optional reason + comment. A second click on the active thumb undoes.
 */
export function AiFeedbackButtons({
  workspaceId,
  surface,
  targetId,
  variant = '',
  feedback,
  label,
  className,
}: AiFeedbackButtonsProps) {
  const rate = useRateAiAnswer(workspaceId)
  const remove = useRemoveAiFeedback(workspaceId)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AiFeedbackReason | null>(null)
  const [comment, setComment] = useState('')
  const busy = rate.isPending || remove.isPending
  const current = feedback?.rating ?? null

  useEffect(() => {
    if (!open) return
    setReason(feedback?.rating === 'DOWN' ? feedback.reason : null)
    setComment(feedback?.rating === 'DOWN' ? (feedback.comment ?? '') : '')
  }, [open, feedback])

  function undo() {
    if (!feedback) return
    remove.mutate(feedback.id, { onError: notify.error })
  }

  function thumbsUp() {
    if (current === 'UP') return undo()
    rate.mutate(
      { surface, targetId, variant, rating: 'UP' },
      { onError: notify.error },
    )
  }

  function submitDown() {
    rate.mutate(
      {
        surface,
        targetId,
        variant,
        rating: 'DOWN',
        reason,
        comment: comment.trim() || null,
      },
      {
        onSuccess: () => {
          setOpen(false)
          notify.success('Obrigado! Sua avaliação ajuda a melhorar a IA.')
        },
        onError: notify.error,
      },
    )
  }

  return (
    <div
      className={cn('flex items-center gap-1 text-muted-foreground', className)}
      data-testid='ai-feedback'
    >
      {label ? <span className='mr-1 text-xs'>{label}</span> : null}
      <Button
        type='button'
        variant='ghost'
        size='icon-xs'
        aria-label='Resposta útil'
        aria-pressed={current === 'UP'}
        title={current === 'UP' ? 'Desfazer avaliação' : 'Resposta útil'}
        disabled={busy || feedback === undefined}
        onClick={thumbsUp}
        className={cn(current === 'UP' && 'bg-muted text-foreground')}
      >
        <SteelIcon icon={ThumbsUpIcon} strokeWidth={2} className='size-3.5' />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label='Resposta não ajudou'
              aria-pressed={current === 'DOWN'}
              title='Resposta não ajudou'
              disabled={busy || feedback === undefined}
              className={cn(current === 'DOWN' && 'bg-muted text-foreground')}
            />
          }
        >
          <SteelIcon
            icon={ThumbsDownIcon}
            strokeWidth={2}
            className='size-3.5'
          />
        </PopoverTrigger>
        <PopoverContent align='start' className='w-80 gap-3'>
          <PopoverHeader>
            <PopoverTitle>O que deu errado?</PopoverTitle>
            <PopoverDescription>
              Opcional. Quem administra o espaço de trabalho vê as avaliações
              para melhorar a IA.
            </PopoverDescription>
          </PopoverHeader>
          <fieldset className='flex flex-wrap gap-1.5'>
            <legend className='sr-only'>Motivo</legend>
            {AI_FEEDBACK_REASONS.map((key) => (
              <Button
                key={key}
                type='button'
                size='xs'
                variant={reason === key ? 'secondary' : 'outline'}
                aria-pressed={reason === key}
                onClick={() => setReason(reason === key ? null : key)}
              >
                {AI_FEEDBACK_REASON_LABELS[key]}
              </Button>
            ))}
          </fieldset>
          <div className='space-y-1.5'>
            <Label htmlFor={`ai-feedback-${targetId}-${variant}`}>
              Comentário
            </Label>
            <Textarea
              id={`ai-feedback-${targetId}-${variant}`}
              value={comment}
              maxLength={COMMENT_MAX}
              rows={3}
              placeholder='O que você esperava?'
              onChange={(event) => setComment(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Evite incluir dados pessoais de clientes.
            </p>
          </div>
          <div className='flex items-center justify-between gap-2'>
            {current === 'DOWN' ? (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={busy}
                onClick={() => {
                  undo()
                  setOpen(false)
                }}
              >
                Remover avaliação
              </Button>
            ) : (
              <span />
            )}
            <Button
              type='button'
              size='sm'
              disabled={busy}
              onClick={submitDown}
            >
              Enviar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Self-loading variant for screens that show a single rated answer. */
export function AiFeedbackControl(
  props: Omit<AiFeedbackButtonsProps, 'feedback'>,
) {
  const mine = useMyAiFeedback(props.workspaceId, props.surface, [
    props.targetId,
  ])
  const feedback = mine.data
    ? (mine.data.get(feedbackKey(props.targetId, props.variant)) ?? null)
    : mine.isError
      ? null
      : undefined
  return <AiFeedbackButtons {...props} feedback={feedback} />
}
