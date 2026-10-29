'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { reengageNewsletter } from '@/src/hooks/use-crm-newsletter-automation'

type State =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'done'; resubscribed: boolean }
  | { kind: 'error'; message: string }

/**
 * Button of `/newsletter/continuar/<token>` (newsletter2, nl2-automation):
 * the page's GET only reads, the click confirms (link scanners never do).
 */
export function NewsletterReengageConfirm({
  token,
  email,
  newsletterName,
  alreadyConfirmed,
}: {
  token: string
  email: string
  newsletterName: string
  alreadyConfirmed: boolean
}) {
  const [state, setState] = useState<State>(
    alreadyConfirmed ? { kind: 'done', resubscribed: false } : { kind: 'idle' },
  )

  async function confirm() {
    setState({ kind: 'pending' })
    try {
      const result = await reengageNewsletter(token)
      setState({ kind: 'done', resubscribed: result.resubscribed })
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível confirmar agora. Tente de novo.',
      })
    }
  }

  if (state.kind === 'done') {
    return (
      <div className='space-y-2'>
        <h1 className='font-semibold text-lg'>Que bom que você fica!</h1>
        <p className='text-muted-foreground text-sm'>
          {state.resubscribed
            ? `Sua inscrição na newsletter ${newsletterName} foi reativada.`
            : `Você continua recebendo a newsletter ${newsletterName}.`}
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <h1 className='font-semibold text-lg'>Continuar recebendo?</h1>
        <p className='text-muted-foreground text-sm'>
          Confirme para seguir recebendo <strong>{newsletterName}</strong> neste
          endereço:
        </p>
        <p className='break-all font-medium text-sm'>{email}</p>
      </div>
      {state.kind === 'error' ? (
        <p className='text-destructive text-sm' role='alert'>
          {state.message}
        </p>
      ) : null}
      <Button
        className='w-full'
        disabled={state.kind === 'pending'}
        onClick={() => void confirm()}
      >
        Quero continuar recebendo
      </Button>
    </div>
  )
}
