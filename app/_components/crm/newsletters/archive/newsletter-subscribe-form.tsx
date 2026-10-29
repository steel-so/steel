'use client'

import {
  CheckmarkCircle02Icon,
  Mail01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  NEWSLETTER_SUBSCRIBE_ENDPOINT,
  NEWSLETTER_SUCCESS_COPY,
  parseSubscribeResponse,
} from '@/src/lib/newsletter/subscribe-client'
import { CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT } from '@/src/schemas/crm-newsletter.schema'

export interface NewsletterSubscribeFormProps {
  workspaceSlug: string
  newsletterSlug: string
  newsletterName: string
  doubleOptIn: boolean
  /** Shown above the fields (the archive home and the end of an issue). */
  title?: string
  description?: string
  className?: string
}

/**
 * Subscribe form of the public archive (`/n/<ws>/<newsletter>`). Posts to
 * `POST /api/newsletters/subscribe` with `source: 'PUBLIC_PAGE'`; the
 * honeypot `website` stays empty for people and is filled by naive bots,
 * which get the same success state without anything being sent.
 */
export function NewsletterSubscribeForm({
  workspaceSlug,
  newsletterSlug,
  newsletterName,
  doubleOptIn,
  title = 'Receba as próximas edições',
  description,
  className,
}: NewsletterSubscribeFormProps) {
  const id = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'pending' | 'active' | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (website) {
      setDone(doubleOptIn ? 'pending' : 'active')
      return
    }
    if (!consent) {
      setError('Marque a autorização para assinar.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(NEWSLETTER_SUBSCRIBE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSlug,
          newsletterSlug,
          email: email.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          consent: true,
          source: 'PUBLIC_PAGE',
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      const outcome = parseSubscribeResponse(response.status, body, doubleOptIn)
      if (outcome.ok) setDone(outcome.pending ? 'pending' : 'active')
      else setError(outcome.message)
    } catch {
      setError('Sem conexão. Verifique a internet e tente de novo.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    const copy = NEWSLETTER_SUCCESS_COPY[done]
    return (
      <div
        role='status'
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center',
          className,
        )}
      >
        <SteelIcon
          icon={done === 'pending' ? Mail01Icon : CheckmarkCircle02Icon}
          size={28}
          className='text-primary'
        />
        <p className='font-semibold text-base text-foreground'>{copy.title}</p>
        <p className='max-w-md text-muted-foreground text-sm'>{copy.body}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Assinar ${newsletterName}`}
      className={cn(
        'grid gap-4 rounded-xl border bg-card p-5 sm:p-6',
        className,
      )}
    >
      <div className='space-y-1'>
        <p className='font-semibold text-base text-foreground'>{title}</p>
        {description ? (
          <p className='text-muted-foreground text-sm'>{description}</p>
        ) : null}
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-name`}>Nome (opcional)</Label>
          <Input
            id={`${id}-name`}
            name='name'
            autoComplete='name'
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-email`}>E-mail</Label>
          <Input
            id={`${id}-email`}
            name='email'
            type='email'
            autoComplete='email'
            inputMode='email'
            required
            maxLength={254}
            placeholder='voce@empresa.com.br'
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
        </div>
      </div>
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden='true' className='hidden'>
        <label htmlFor={`${id}-website`}>Não preencha este campo</label>
        <input
          id={`${id}-website`}
          name='website'
          tabIndex={-1}
          autoComplete='off'
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <div className='flex items-start gap-2.5'>
        <Checkbox
          id={`${id}-consent`}
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          disabled={submitting}
          className='mt-0.5'
        />
        <Label
          htmlFor={`${id}-consent`}
          className='font-normal text-muted-foreground text-sm leading-snug'
        >
          {CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT}
        </Label>
      </div>
      {error ? (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      ) : null}
      <Button
        type='submit'
        disabled={submitting}
        className='w-full sm:w-auto sm:justify-self-start'
      >
        {submitting ? 'Enviando…' : 'Assinar'}
      </Button>
    </form>
  )
}
