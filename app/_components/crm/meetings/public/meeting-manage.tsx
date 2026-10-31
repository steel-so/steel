'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/src/hooks/_fetch'
import type { PublicMeetingBookingDTO } from '@/types/crm-meeting'

/** What the guest sees at the link in the e-mail: the meeting and a cancel button. */
export function MeetingManage({
  token,
  booking: initial,
}: {
  token: string
  booking: PublicMeetingBookingDTO
}) {
  const [booking, setBooking] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(booking.startsAt))
  const canceled = booking.status === 'CANCELED'

  async function cancel() {
    if (!window.confirm('Cancelar esta reunião?')) return
    setBusy(true)
    setError(null)
    try {
      setBooking(
        await apiFetch<PublicMeetingBookingDTO>(
          `/api/crm/meeting-bookings/${encodeURIComponent(token)}`,
          { method: 'DELETE' },
          'Não foi possível cancelar',
        ),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível cancelar',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-xl border bg-background p-6'>
      <p className='text-muted-foreground text-xs'>{booking.workspaceName}</p>
      <h1 className='font-semibold text-xl'>
        {canceled ? 'Reunião cancelada' : 'Sua reunião'}
      </h1>
      <p className='text-sm'>
        {booking.pageTitle} com {booking.hostName}
      </p>
      <p className={canceled ? 'font-medium line-through' : 'font-medium'}>
        {when}
      </p>
      <p className='text-muted-foreground text-xs'>Horário de {zone}</p>
      {!canceled && booking.location ? (
        <p className='break-words text-sm'>Local ou link: {booking.location}</p>
      ) : null}
      {error ? (
        <p className='text-destructive text-sm' role='alert'>
          {error}
        </p>
      ) : null}
      {canceled ? (
        <p className='text-muted-foreground text-sm'>
          Este agendamento foi cancelado. Se quiser, escolha um novo horário no
          link que você recebeu da {booking.workspaceName}.
        </p>
      ) : (
        <Button variant='outline' onClick={cancel} disabled={busy}>
          {busy ? 'Cancelando…' : 'Cancelar reunião'}
        </Button>
      )}
    </div>
  )
}
