'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { NewsletterPreferencesDTO } from '@/src/schemas/crm-newsletter.schema'

/** Preference center: one switch per newsletter, plus "sair de tudo". */
export function NewsletterPreferencesForm({
  token,
  initial,
}: {
  token: string
  initial: NewsletterPreferencesDTO
}) {
  const [preferences, setPreferences] = useState(initial)
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(initial.newsletters.filter((n) => n.subscribed).map((n) => n.id)),
  )
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function save(unsubscribeAll: boolean) {
    setPending(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/newsletters/preferences/${encodeURIComponent(token)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscribedNewsletterIds: unsubscribeAll ? [] : [...selected],
            unsubscribeAll,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        setMessage({
          kind: 'error',
          text:
            body?.error?.message ?? 'Não foi possível salvar. Tente novamente.',
        })
        return
      }
      const saved = body.data as NewsletterPreferencesDTO
      setPreferences(saved)
      setSelected(
        new Set(saved.newsletters.filter((n) => n.subscribed).map((n) => n.id)),
      )
      setMessage({
        kind: 'ok',
        text: unsubscribeAll
          ? 'Pronto: você não recebe mais e-mails de marketing deste remetente.'
          : 'Preferências salvas.',
      })
    } catch {
      setMessage({ kind: 'error', text: 'Falha de conexão. Tente novamente.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='space-y-5'>
      <div className='space-y-1'>
        <h1 className='font-semibold text-lg'>Preferências de e-mail</h1>
        <p className='text-muted-foreground text-sm'>
          Escolha quais newsletters de{' '}
          <strong>{preferences.workspaceName}</strong> você quer receber em{' '}
          <span className='break-all font-medium text-foreground'>
            {preferences.email}
          </span>
          .
        </p>
      </div>

      {preferences.optedOutOfAll ? (
        <p className='rounded-lg border bg-muted/40 p-3 text-sm'>
          Você saiu de todos os e-mails de marketing deste remetente. Ligar uma
          newsletter abaixo desfaz essa escolha.
        </p>
      ) : null}

      {preferences.newsletters.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Não há newsletters ativas no momento.
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {preferences.newsletters.map((newsletter) => (
            <li
              key={newsletter.id}
              className='flex items-start justify-between gap-3 p-3'
            >
              <div className='min-w-0'>
                <p className='font-medium text-sm'>{newsletter.name}</p>
                {newsletter.cadenceLabel ? (
                  <p className='text-muted-foreground text-xs'>
                    {newsletter.cadenceLabel}
                  </p>
                ) : null}
                {newsletter.description ? (
                  <p className='mt-1 text-muted-foreground text-xs'>
                    {newsletter.description}
                  </p>
                ) : null}
              </div>
              <Switch
                checked={selected.has(newsletter.id)}
                onCheckedChange={(checked) => toggle(newsletter.id, checked)}
                aria-label={`Receber ${newsletter.name}`}
                disabled={pending}
              />
            </li>
          ))}
        </ul>
      )}

      <div className='space-y-1.5'>
        <Label htmlFor='preferences-reason'>
          Saindo de alguma? Conte o motivo (opcional)
        </Label>
        <Textarea
          id='preferences-reason'
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {message ? (
        <p
          className={
            message.kind === 'ok' ? 'text-sm' : 'text-destructive text-sm'
          }
          role='status'
        >
          {message.text}
        </p>
      ) : null}

      <div className='flex flex-col gap-2 sm:flex-row-reverse'>
        <Button
          className='sm:flex-1'
          disabled={pending}
          onClick={() => save(false)}
        >
          Salvar preferências
        </Button>
        <Button
          variant='outline'
          className='sm:flex-1'
          disabled={pending}
          onClick={() => save(true)}
        >
          Sair de tudo
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        "Sair de tudo" também vale para as outras campanhas de e-mail de{' '}
        {preferences.workspaceName}. Mensagens essenciais da sua conta não são
        afetadas.
      </p>
    </div>
  )
}
