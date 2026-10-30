'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import { bookPublicMeeting, publicMeetingApi } from '@/src/hooks/use-crm-meetings'
import type {
  PublicMeetingBookingDTO,
  PublicMeetingPageDTO,
  PublicMeetingSlotsDTO,
} from '@/types/crm-meeting'

const DAYS_SHOWN = 21

function dayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function dayLabel(key: string): { weekday: string; day: string } {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  return {
    weekday: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      weekday: 'short',
    }).format(date),
    day: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
    }).format(date),
  }
}

const timeLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const fullLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export interface MeetingPrefill {
  name?: string
  email?: string
  phone?: string
}

/**
 * The public booking widget: pick a free day and time, leave contact data,
 * done. Used by `/m/<slug>`, by the iframe (`/m/<slug>/embed`) and right
 * after a CRM form submission.
 */
export function MeetingBookingWidget({
  page,
  prefill,
  compact = false,
}: {
  page: PublicMeetingPageDTO
  prefill?: MeetingPrefill
  compact?: boolean
}) {
  const [guestZone, setGuestZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || page.timezone,
  )
  const [window0] = useState(() => new Date().toISOString())
  const slots = useQuery({
    queryKey: ['public-meeting-slots', page.slug],
    queryFn: () =>
      apiFetch<PublicMeetingSlotsDTO>(
        publicMeetingApi.slotsUrl(page.slug, window0, 30),
        undefined,
        'Não foi possível carregar os horários',
      ),
    refetchInterval: 60_000,
  })

  const days = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const iso of slots.data?.slots ?? []) {
      const key = dayKey(iso, guestZone)
      map.set(key, [...(map.get(key) ?? []), iso])
    }
    return [...map.entries()].slice(0, DAYS_SHOWN)
  }, [slots.data, guestZone])

  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState(prefill?.name ?? '')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [phone, setPhone] = useState(prefill?.phone ?? '')
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<PublicMeetingBookingDTO | null>(null)

  const activeDay = selectedDay ?? days[0]?.[0] ?? null
  const times = days.find(([key]) => key === activeDay)?.[1] ?? []

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await bookPublicMeeting(page.slug, {
        startsAt: selected,
        name,
        email,
        phone: phone || null,
        notes: notes || null,
        timezone: guestZone,
        consent: true,
      })
      setBooked(result)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível agendar',
      )
      void slots.refetch()
      setSelected(null)
    } finally {
      setSubmitting(false)
    }
  }

  if (booked) {
    return (
      <div className='flex flex-col gap-3 rounded-xl border bg-card p-6' role='status'>
        <h2 className='font-semibold text-xl'>Reunião confirmada</h2>
        <p className='text-sm'>
          {booked.pageTitle} com {booked.hostName}
        </p>
        <p className='font-medium'>{fullLabel(booked.startsAt, guestZone)}</p>
        <p className='text-muted-foreground text-xs'>Horário de {guestZone}</p>
        {booked.location ? (
          <p className='break-words text-sm'>Local ou link: {booked.location}</p>
        ) : null}
        <p className='text-muted-foreground text-sm'>
          Enviamos a confirmação para {email}, com o convite para a sua agenda.
        </p>
        <Link
          className='text-primary text-sm underline'
          href={`/m/b/${booked.manageToken}`}
          target={compact ? '_blank' : undefined}
        >
          Ver ou cancelar o agendamento
        </Link>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      <header className='flex flex-col gap-1'>
        <p className='text-muted-foreground text-xs'>{page.workspaceName}</p>
        <h1 className={cn('font-semibold', compact ? 'text-xl' : 'text-2xl')}>
          {page.title}
        </h1>
        <p className='text-muted-foreground text-sm'>
          {page.durationMinutes} minutos ·{' '}
          {page.format === 'ONLINE' ? 'Online' : 'Presencial'}
        </p>
        {page.description ? (
          <p className='whitespace-pre-line text-sm'>{page.description}</p>
        ) : null}
      </header>

      {slots.isLoading ? (
        <Skeleton className='h-40' />
      ) : slots.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar os horários. Tente de novo em instantes.
        </p>
      ) : days.length === 0 ? (
        <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Não há horários livres nos próximos dias. Volte mais tarde.
        </p>
      ) : (
        <>
          <div className='flex flex-col gap-2'>
            <Label>Escolha o dia</Label>
            <div className='flex flex-wrap gap-2'>
              {days.map(([key, list]) => {
                const label = dayLabel(key)
                return (
                  <button
                    key={key}
                    type='button'
                    aria-pressed={key === activeDay}
                    onClick={() => {
                      setSelectedDay(key)
                      setSelected(null)
                    }}
                    className={cn(
                      'flex w-20 flex-col items-center rounded-lg border px-2 py-1.5 text-sm transition-colors',
                      key === activeDay
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className='text-muted-foreground text-xs capitalize'>
                      {label.weekday}
                    </span>
                    <span className='font-medium'>{label.day}</span>
                    <span className='text-muted-foreground text-xs'>
                      {list.length} {list.length === 1 ? 'horário' : 'horários'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <Label>Escolha o horário</Label>
            <div className='flex flex-wrap gap-2'>
              {times.map((iso) => (
                <Button
                  key={iso}
                  type='button'
                  size='sm'
                  variant={iso === selected ? 'default' : 'outline'}
                  aria-pressed={iso === selected}
                  onClick={() => setSelected(iso)}
                >
                  {timeLabel(iso, guestZone)}
                </Button>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>
              Horários no fuso {guestZone}.{' '}
              {guestZone !== page.timezone ? (
                <button
                  type='button'
                  className='underline'
                  onClick={() => setGuestZone(page.timezone)}
                >
                  Ver em {page.timezone}
                </button>
              ) : null}
            </p>
          </div>
        </>
      )}

      {selected ? (
        <form
          className='flex flex-col gap-3 rounded-xl border bg-card p-4'
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <p className='font-medium text-sm'>{fullLabel(selected, guestZone)}</p>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-guest-name'>Nome</Label>
            <Input
              id='meeting-guest-name'
              required
              minLength={2}
              maxLength={120}
              autoComplete='name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-guest-email'>E-mail</Label>
            <Input
              id='meeting-guest-email'
              type='email'
              required
              autoComplete='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-guest-phone'>Telefone (opcional)</Label>
            <Input
              id='meeting-guest-phone'
              type='tel'
              autoComplete='tel'
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-guest-notes'>Sobre o que quer conversar? (opcional)</Label>
            <Textarea
              id='meeting-guest-notes'
              rows={3}
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <label className='flex items-start gap-2 text-sm'>
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            <span>
              Concordo que {page.workspaceName} use meus dados para agendar esta
              reunião e entrar em contato sobre ela.
            </span>
          </label>
          {error ? (
            <p className='text-destructive text-sm' role='alert'>
              {error}
            </p>
          ) : null}
          <Button type='submit' disabled={submitting || !consent}>
            {submitting ? 'Agendando…' : 'Confirmar agendamento'}
          </Button>
        </form>
      ) : error ? (
        <p className='text-destructive text-sm' role='alert'>
          {error}
        </p>
      ) : null}
    </div>
  )
}
