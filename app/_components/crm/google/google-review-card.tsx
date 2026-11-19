'use client'

import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useDeleteGoogleReviewReply,
  useReplyGoogleReview,
  useSuggestGoogleReviewReply,
} from '@/src/hooks/use-crm-google-presence'
import {
  GOOGLE_NEGATIVE_MAX_STARS,
  GOOGLE_REPLY_MAX,
  type GoogleReviewDTO,
} from '@/src/schemas/crm-google-presence.schema'
import { formatDate } from './google-format'
import { GoogleStars } from './google-stars'

/** One review with its reply box: write, ask the AI for a draft, edit or remove. */
export function GoogleReviewCard({
  workspaceId,
  review,
}: {
  workspaceId: string
  review: GoogleReviewDTO
}) {
  const reply = useReplyGoogleReview(workspaceId)
  const removeReply = useDeleteGoogleReviewReply(workspaceId)
  const suggest = useSuggestGoogleReviewReply(workspaceId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [aiDraft, setAiDraft] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const negative = review.starRating <= GOOGLE_NEGATIVE_MAX_STARS
  const needsReply = review.reply === null

  function openEditor() {
    setText(review.reply?.comment ?? '')
    setAiDraft(false)
    setEditing(true)
  }

  function send() {
    reply.mutate(
      { reviewId: review.id, comment: text.trim() },
      {
        onSuccess: () => {
          notify.success('Resposta publicada no Google.')
          setEditing(false)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  function askAi() {
    suggest.mutate(review.id, {
      onSuccess: (data) => {
        setText(data.suggestion)
        setAiDraft(true)
      },
      onError: (error) => notify.error(error),
    })
  }

  return (
    <Card
      size='sm'
      className={
        negative && needsReply
          ? 'gap-3 px-5 ring-1 ring-rose-500/40'
          : 'gap-3 px-5'
      }
    >
      <div className='flex items-start gap-3'>
        <Avatar>
          {review.reviewerPhotoUrl ? (
            <AvatarImage src={review.reviewerPhotoUrl} alt='' />
          ) : null}
          <AvatarFallback>
            {review.reviewerName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <span className='truncate font-medium text-sm'>
              {review.reviewerName}
            </span>
            <GoogleStars value={review.starRating} />
            <span className='text-muted-foreground text-xs'>
              {formatDate(review.reviewedAt)}
            </span>
            {needsReply ? (
              <Badge variant={negative ? 'destructive' : 'secondary'}>
                Sem resposta
              </Badge>
            ) : null}
          </div>
          {review.comment ? (
            <p className='mt-1.5 whitespace-pre-wrap break-words text-sm'>
              {review.comment}
            </p>
          ) : (
            <p className='mt-1.5 text-muted-foreground text-sm'>
              O cliente deixou só a nota.
            </p>
          )}
        </div>
      </div>

      {review.reply && !editing ? (
        <div className='ml-12 space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3'>
          <p className='font-medium text-xs'>
            Resposta do proprietário
            {review.reply.updatedAt
              ? ` · ${formatDate(review.reply.updatedAt)}`
              : ''}
          </p>
          <p className='whitespace-pre-wrap break-words text-sm'>
            {review.reply.comment}
          </p>
          <div className='flex gap-2'>
            <Button variant='ghost' size='xs' onClick={openEditor}>
              Editar resposta
            </Button>
            <Button
              variant='ghost'
              size='xs'
              onClick={() => setConfirmDelete(true)}
            >
              Apagar
            </Button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className='ml-12 space-y-2'>
          <Textarea
            value={text}
            rows={5}
            maxLength={GOOGLE_REPLY_MAX}
            aria-label='Resposta à avaliação'
            placeholder='Escreva a resposta pública…'
            onChange={(event) => {
              setText(event.target.value)
              setAiDraft(false)
            }}
          />
          {aiDraft ? (
            <p className='text-muted-foreground text-xs'>
              Rascunho gerado por IA. Leia e ajuste antes de publicar.
            </p>
          ) : null}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={suggest.isPending}
              onClick={askAi}
            >
              <SteelIcon icon={SparklesIcon} size={14} />
              {suggest.isPending ? 'Gerando…' : 'Sugerir resposta'}
            </Button>
            <div className='flex gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setEditing(false)}
              >
                Cancelar
              </Button>
              <Button
                size='sm'
                disabled={!text.trim() || reply.isPending}
                onClick={send}
              >
                {reply.isPending ? 'Publicando…' : 'Publicar resposta'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!review.reply && !editing ? (
        <div className='ml-12'>
          <Button variant='outline' size='sm' onClick={openEditor}>
            Responder
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar a resposta?</AlertDialogTitle>
            <AlertDialogDescription>
              A resposta some do Google e a avaliação volta a ficar sem
              resposta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeReply.mutate(review.id, {
                  onSuccess: () => notify.success('Resposta apagada.'),
                  onError: (error) => notify.error(error),
                })
              }
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
