'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmMeetingAvailability,
  useSaveCrmMeetingAvailability,
} from '@/src/hooks/use-crm-meetings'
import type { WeeklyHoursDTO } from '@/types/crm-meeting'
import { COMMON_TIMEZONES, WEEKDAYS } from './meeting-labels'

const TIMEZONE_ITEMS = COMMON_TIMEZONES.map((value) => ({ value, label: value }))

/** Each seller's working hours, time zone and (optional) calendar feed. */
export function MeetingAvailabilityForm({
  workspaceId,
}: {
  workspaceId: string
}) {
  const availability = useCrmMeetingAvailability(workspaceId)
  const save = useSaveCrmMeetingAvailability(workspaceId)
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [hours, setHours] = useState<WeeklyHoursDTO>({})
  const [icsUrl, setIcsUrl] = useState('')

  useEffect(() => {
    if (!availability.data) return
    setTimezone(availability.data.timezone)
    setHours(availability.data.weeklyHours)
    setIcsUrl('')
  }, [availability.data])

  function windowOf(day: string) {
    return hours[day]?.[0] ?? null
  }

  function setWindow(day: string, next: { start: string; end: string } | null) {
    setHours((current) => {
      const copy = { ...current }
      if (next) copy[day] = [next]
      else delete copy[day]
      return copy
    })
  }

  function submit(removeFeed = false) {
    save.mutate(
      {
        timezone,
        weeklyHours: hours,
        icsUrl: removeFeed ? null : icsUrl.trim() || undefined,
      },
      {
        onSuccess: () => {
          notify.success(removeFeed ? 'Agenda desconectada' : 'Disponibilidade salva')
          setIcsUrl('')
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  if (availability.isLoading) return <Skeleton className='h-80 max-w-2xl' />
  if (availability.isError || !availability.data) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar a disponibilidade.
      </p>
    )
  }

  return (
    <div className='flex max-w-2xl flex-col gap-5'>
      <p className='text-muted-foreground text-sm'>
        São os horários em que você aceita reuniões nas páginas de agendamento.
        O Steel já desconta o que está na sua agenda do CRM e nas reuniões
        marcadas.
      </p>

      <div className='flex flex-col gap-1.5'>
        <Label>Seu fuso horário</Label>
        <Select
          items={TIMEZONE_ITEMS}
          value={timezone}
          onValueChange={(value) => setTimezone(String(value))}
        >
          <SelectTrigger className='w-72' aria-label='Seu fuso horário'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className='flex flex-col divide-y rounded-lg border'>
        {WEEKDAYS.map((day) => {
          const window = windowOf(day.key)
          return (
            <li key={day.key} className='flex flex-wrap items-center gap-3 px-3 py-2'>
              <label className='flex w-28 items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  className='size-4 accent-primary'
                  checked={window !== null}
                  onChange={(event) =>
                    setWindow(
                      day.key,
                      event.target.checked ? { start: '09:00', end: '18:00' } : null,
                    )
                  }
                />
                {day.label}
              </label>
              {window ? (
                <div className='flex items-center gap-2 text-sm'>
                  <Input
                    type='time'
                    aria-label={`${day.label}: início`}
                    className='w-28'
                    value={window.start}
                    onChange={(event) =>
                      setWindow(day.key, { ...window, start: event.target.value })
                    }
                  />
                  <span className='text-muted-foreground'>até</span>
                  <Input
                    type='time'
                    aria-label={`${day.label}: fim`}
                    className='w-28'
                    value={window.end}
                    onChange={(event) =>
                      setWindow(day.key, { ...window, end: event.target.value })
                    }
                  />
                </div>
              ) : (
                <span className='text-muted-foreground text-sm'>Indisponível</span>
              )}
            </li>
          )
        })}
      </ul>

      <section className='flex flex-col gap-2 rounded-lg border p-3'>
        <h3 className='font-medium text-sm'>Agenda do Google ou do Outlook</h3>
        <p className='text-muted-foreground text-xs'>
          Cole o endereço secreto em formato iCal (.ics) da sua agenda. O Steel
          lê só os horários ocupados, sem título nem convidados, e não oferece
          esses horários. No Google: Configurações da agenda › Integrar agenda ›
          “Endereço secreto no formato iCal”. No Outlook: Configurações ›
          Calendário › Calendários compartilhados › Publicar um calendário.
        </p>
        {availability.data.hasCalendarFeed ? (
          <p className='text-sm'>
            Agenda conectada
            {availability.data.calendarLastError
              ? `, mas a última leitura falhou: ${availability.data.calendarLastError}`
              : '.'}
          </p>
        ) : null}
        <Input
          type='url'
          aria-label='Endereço iCal da agenda'
          placeholder={
            availability.data.hasCalendarFeed
              ? 'Cole um novo endereço para trocar'
              : 'https://calendar.google.com/calendar/ical/…/basic.ics'
          }
          value={icsUrl}
          onChange={(event) => setIcsUrl(event.target.value)}
        />
        {availability.data.hasCalendarFeed ? (
          <Button
            variant='ghost'
            size='sm'
            className='self-start'
            onClick={() => submit(true)}
            disabled={save.isPending}
          >
            Desconectar agenda
          </Button>
        ) : null}
        <p className='text-muted-foreground text-xs'>
          A conexão direta com Google e Outlook (login e permissão) fica
          desligada até a Stratus registrar o aplicativo nos dois provedores.
        </p>
      </section>

      <Button className='self-start' onClick={() => submit()} disabled={save.isPending}>
        {save.isPending ? 'Salvando…' : 'Salvar disponibilidade'}
      </Button>
    </div>
  )
}
