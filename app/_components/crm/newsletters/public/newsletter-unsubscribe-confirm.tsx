'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { NewsletterUnsubscribeResultDTO } from '@/src/schemas/crm-newsletter.schema'

type State =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'done'; result: NewsletterUnsubscribeResultDTO }
  | { kind: 'error'; message: string }

/** Confirm button (+ optional reason) of `/newsletter/sair/<token>`. */
export function NewsletterUnsubscribeConfirm({
  token,
  email,
  newsletterName,
  preferencesUrl,
}: {
  token: string
  email: string
  newsletterName: string
  preferencesUrl: string
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [reason, setReason] = useState('')

  async function confirm() {
    setState({ kind: 'pending' })
    try {
      const response = await fetch(
        `/api/newsletters/unsubscribe/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        setState({
          kind: 'error',
          message:
            body?.error?.message ??
            'Não foi possível concluir o descadastro. Tente novamente.',
        })
        return
      }
      setState({ kind: 'done', result: body.data })
    } catch {
      setState({ kind: 'error', message: 'Falha de conexão. Tente novamente.' })
    }
  }

  if (state.kind === 'done') {
    return (
      <div className='space-y-3'>
        <h1 className='font-semibold text-lg'>Pronto, você saiu</h1>
        <p className='text-muted-foreground text-sm'>
          {state.result.email} não recebe mais a newsletter{' '}
          {state.result.newsletterName}.
        </p>
        <a
          href={preferencesUrl}
          className='text-primary text-sm underline underline-offset-2'
        >
          Gerenciar todas as newsletters
        </a>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <h1 className='font-semibold text-lg'>Sair da newsletter</h1>
        <p className='text-muted-foreground text-sm'>
          Deseja parar de receber <strong>{newsletterName}</strong> neste
          endereço?
        </p>
        <p className='break-all font-medium text-sm'>{email}</p>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='unsubscribe-reason'>
          Quer contar o motivo? (opcional)
        </Label>
        <Textarea
          id='unsubscribe-reason'
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {state.kind === 'error' ? (
        <p className='text-destructive text-sm'>{state.message}</p>
      ) : null}
      <Button
        className='w-full'
        onClick={confirm}
        disabled={state.kind === 'pending'}
      >
        {state.kind === 'pending' ? 'Descadastrando…' : 'Confirmar descadastro'}
      </Button>
      <a
        href={preferencesUrl}
        className='block text-center text-muted-foreground text-sm underline underline-offset-2'
      >
        Prefiro escolher quais newsletters recebo
      </a>
    </div>
  )
}
