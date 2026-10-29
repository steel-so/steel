'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useAnswerPublicSurvey } from '@/src/hooks/use-satisfaction-surveys'
import type { PublicSurveyDTO } from '@/types/satisfaction-survey'

/** Formulário público da pesquisa por e-mail: nota + comentário opcional. */
export function PublicSurveyForm({
  token,
  survey,
  initialScore,
}: {
  token: string
  survey: PublicSurveyDTO
  initialScore: number | null
}) {
  const answer = useAnswerPublicSurvey(token)
  const [done, setDone] = useState(survey.state === 'ANSWERED')
  const [score, setScore] = useState<number | null>(
    initialScore !== null &&
      initialScore >= survey.scaleMin &&
      initialScore <= survey.scaleMax
      ? initialScore
      : null,
  )
  const [comment, setComment] = useState('')

  if (survey.state === 'EXPIRED') {
    return (
      <div className='space-y-2'>
        <h1 className='font-semibold text-lg'>Pesquisa encerrada</h1>
        <p className='text-muted-foreground text-sm'>
          O prazo para responder esta pesquisa de {survey.workspaceName} já
          passou. Obrigado pelo interesse!
        </p>
      </div>
    )
  }
  if (done) {
    return (
      <div className='space-y-2'>
        <h1 className='font-semibold text-lg'>Obrigado pela sua avaliação!</h1>
        <p className='text-muted-foreground text-sm'>
          Sua resposta ajuda {survey.workspaceName} a melhorar o atendimento.
        </p>
      </div>
    )
  }

  const scores: number[] = []
  for (let n = survey.scaleMin; n <= survey.scaleMax; n++) scores.push(n)

  const submit = () => {
    if (score === null) return
    answer.mutate(
      { score, comment: comment.trim() || undefined },
      {
        onSuccess: () => setDone(true),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <div className='space-y-5'>
      <div className='space-y-1'>
        <p className='text-muted-foreground text-xs'>{survey.workspaceName}</p>
        <h1 className='font-semibold text-lg'>Como foi o atendimento?</h1>
        <p className='text-muted-foreground text-sm'>{survey.question}</p>
      </div>
      <fieldset className='flex flex-wrap gap-2 border-0 p-0'>
        <legend className='sr-only'>Nota</legend>
        {scores.map((n) => (
          <button
            key={n}
            type='button'
            aria-pressed={score === n}
            onClick={() => setScore(n)}
            className={cn(
              'size-10 rounded-md border text-sm font-medium tabular-nums transition-colors',
              score === n
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted',
            )}
          >
            {n}
          </button>
        ))}
      </fieldset>
      <div className='space-y-1.5'>
        <Label htmlFor='survey-comment'>Quer contar mais? (opcional)</Label>
        <Textarea
          id='survey-comment'
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <Button
        className='w-full'
        disabled={score === null || answer.isPending}
        onClick={submit}
      >
        {answer.isPending ? 'Enviando…' : 'Enviar avaliação'}
      </Button>
    </div>
  )
}
