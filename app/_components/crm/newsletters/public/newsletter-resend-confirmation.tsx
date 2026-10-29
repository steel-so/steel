'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

type State = 'idle' | 'pending' | 'sent' | 'error'

/** "Link expired" page: asks for a fresh confirmation e-mail. */
export function NewsletterResendConfirmation({ token }: { token: string }) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function resend() {
    setState('pending')
    try {
      const response = await fetch(
        `/api/newsletters/confirm/${encodeURIComponent(token)}/resend`,
        { method: 'POST' },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        setMessage(
          body?.error?.message ?? 'Não foi possível reenviar. Tente novamente.',
        )
        setState('error')
        return
      }
      setState('sent')
    } catch {
      setMessage('Falha de conexão. Tente novamente.')
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <p className='text-sm'>
        Pronto! Enviamos um novo e-mail de confirmação. Confira a caixa de
        entrada (e o spam).
      </p>
    )
  }
  return (
    <div className='space-y-3'>
      {state === 'error' ? (
        <p className='text-destructive text-sm'>{message}</p>
      ) : null}
      <Button
        className='w-full'
        disabled={state === 'pending'}
        onClick={resend}
      >
        {state === 'pending' ? 'Enviando…' : 'Enviar novo link'}
      </Button>
    </div>
  )
}
