'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CrmNewsletterPollVoteResultDTO } from '@/src/schemas/crm-newsletter-engage.schema'
import { NewsletterInvalidLink } from './newsletter-public-card'

type State =
  | { kind: 'pending' }
  | { kind: 'done'; result: CrmNewsletterPollVoteResultDTO }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }

const percent = (votes: number, total: number) =>
  total > 0 ? Math.round((votes / total) * 100) : 0

/** Bars of the current results, the reader's option highlighted. */
export function NewsletterPollResults({
  result,
}: {
  result: CrmNewsletterPollVoteResultDTO
}) {
  if (!result.results) return null
  const { totalVotes, options } = result.results
  return (
    <section aria-label='Resultado parcial' className='space-y-3'>
      <ul className='space-y-2.5'>
        {options.map((option) => {
          const value = percent(option.votes, totalVotes)
          const chosen = option.index === result.chosenIndex
          return (
            <li key={option.index} className='space-y-1'>
              <div className='flex items-baseline justify-between gap-3 text-sm'>
                <span
                  className={
                    chosen
                      ? 'min-w-0 break-words font-medium'
                      : 'min-w-0 break-words'
                  }
                >
                  {option.label}
                  {chosen ? (
                    <span className='text-muted-foreground'> · seu voto</span>
                  ) : null}
                </span>
                <span className='shrink-0 tabular-nums'>{value}%</span>
              </div>
              <div
                className='h-2 overflow-hidden rounded-full bg-muted'
                role='presentation'
              >
                <div
                  className={
                    chosen
                      ? 'h-full rounded-full bg-primary'
                      : 'h-full rounded-full bg-muted-foreground/40'
                  }
                  style={{ width: `${value}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      <p className='text-muted-foreground text-xs'>
        {totalVotes === 1
          ? '1 voto até agora'
          : `${totalVotes} votos até agora`}
      </p>
    </section>
  )
}

/**
 * Thank-you page of a poll option: posts the vote once the page loads
 * (never on the GET itself) and shows the partial results when the author
 * allowed it.
 */
export function NewsletterPollVote({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'pending' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    async function vote() {
      try {
        const response = await fetch(
          `/api/newsletters/polls/${encodeURIComponent(token)}`,
          { method: 'POST' },
        )
        const body = await response.json().catch(() => null)
        if (!active) return
        if (response.ok && body?.success) {
          setState({ kind: 'done', result: body.data })
          return
        }
        const code = body?.error?.code
        if (
          code === 'CRM_NEWSLETTER_TOKEN_INVALID' ||
          code === 'CRM_NEWSLETTER_POLL_NOT_FOUND'
        ) {
          setState({ kind: 'invalid' })
          return
        }
        setState({
          kind: 'error',
          message:
            body?.error?.message ??
            'Não foi possível registrar o seu voto. Tente novamente.',
        })
      } catch {
        if (active) {
          setState({
            kind: 'error',
            message: 'Falha de conexão. Tente novamente.',
          })
        }
      }
    }
    void vote()
    return () => {
      active = false
    }
  }, [token, attempt])

  if (state.kind === 'pending') {
    return (
      <div className='space-y-2' aria-busy='true'>
        <h1 className='font-semibold text-lg'>Registrando seu voto…</h1>
        <p className='text-muted-foreground text-sm'>Só um instante.</p>
      </div>
    )
  }
  if (state.kind === 'invalid') return <NewsletterInvalidLink what='enquete' />
  if (state.kind === 'error') {
    return (
      <div className='space-y-3'>
        <h1 className='font-semibold text-lg'>Voto não registrado</h1>
        <p className='text-muted-foreground text-sm' role='alert'>
          {state.message}
        </p>
        <Button
          variant='outline'
          onClick={() => {
            setState({ kind: 'pending' })
            setAttempt((value) => value + 1)
          }}
        >
          Tentar de novo
        </Button>
      </div>
    )
  }

  const { result } = state
  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <p className='text-muted-foreground text-xs'>{result.newsletterName}</p>
        <h1 className='font-semibold text-lg'>
          {result.changed ? 'Voto atualizado' : 'Obrigado pelo seu voto!'}
        </h1>
        <p className='break-words text-muted-foreground text-sm'>
          {result.question}
        </p>
        <p className='break-words text-sm'>
          Você escolheu <strong>{result.chosenLabel}</strong>.
        </p>
      </div>
      <NewsletterPollResults result={result} />
      <p className='text-muted-foreground text-xs'>
        Mudou de ideia? Clique em outra opção no e-mail: vale o último voto.
      </p>
    </div>
  )
}
