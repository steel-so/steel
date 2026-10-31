'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useUpdateSchedAppointment,
  useWhatsAppSchedAppointments,
  useWhatsAppSchedulingSettings,
} from '@/src/hooks/use-whatsapp-scheduling'
import type { WhatsAppSchedAppointmentDTO } from '@/types/whatsapp-scheduling'
import { NewAppointmentDialog } from './new-appointment-dialog'
import {
  APPOINTMENT_STATUS,
  addDays,
  dateKeyInZone,
  formatDayLabel,
  formatTimeInZone,
} from './scheduling-labels'

function AppointmentRow({
  workspaceId,
  appointment,
  timeZone,
}: {
  workspaceId: string
  appointment: WhatsAppSchedAppointmentDTO
  timeZone: string
}) {
  const update = useUpdateSchedAppointment(workspaceId)
  const status = APPOINTMENT_STATUS[appointment.status]
  const live =
    appointment.status === 'PENDING' || appointment.status === 'CONFIRMED'
  const started = new Date(appointment.startsAt) <= new Date()

  const act = (
    data: { status: 'CONFIRMED' | 'CANCELED' | 'COMPLETED' | 'NO_SHOW' },
    done: string,
  ) =>
    update.mutate(
      { id: appointment.id, data },
      {
        onSuccess: () => notify.success(done),
        onError: (error) =>
          notify.error(error, 'Não foi possível atualizar o agendamento'),
      },
    )

  return (
    <li className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
      <div className='flex items-center gap-4'>
        <p className='w-14 font-semibold text-lg tabular-nums'>
          {formatTimeInZone(appointment.startsAt, timeZone)}
        </p>
        <div>
          <p className='font-medium text-sm'>
            {appointment.contactName ?? appointment.contactWaId}
          </p>
          <p className='text-muted-foreground text-xs'>
            {appointment.serviceName} com {appointment.professionalName}
          </p>
          {appointment.cancelReason ? (
            <p className='text-muted-foreground text-xs'>
              {appointment.cancelReason}
            </p>
          ) : null}
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant={status.variant}>{status.label}</Badge>
        {live ? (
          <>
            {appointment.status === 'PENDING' ? (
              <Button
                size='sm'
                variant='outline'
                disabled={update.isPending}
                onClick={() =>
                  act({ status: 'CONFIRMED' }, 'Agendamento confirmado')
                }
              >
                Confirmar
              </Button>
            ) : null}
            {started ? (
              <>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={update.isPending}
                  onClick={() =>
                    act({ status: 'COMPLETED' }, 'Atendimento concluído')
                  }
                >
                  Concluir
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={update.isPending}
                  onClick={() => act({ status: 'NO_SHOW' }, 'Falta registrada')}
                >
                  Faltou
                </Button>
              </>
            ) : null}
            <Button
              size='sm'
              variant='outline'
              disabled={update.isPending}
              onClick={() =>
                act({ status: 'CANCELED' }, 'Agendamento cancelado')
              }
            >
              Cancelar
            </Button>
          </>
        ) : null}
      </div>
    </li>
  )
}

/** Agenda do dia: lista os agendamentos e deixa marcar um novo. */
export function AppointmentsPanel({ workspaceId }: { workspaceId: string }) {
  const settings = useWhatsAppSchedulingSettings(workspaceId)
  const timeZone = settings.data?.timezone ?? 'America/Sao_Paulo'
  const today = dateKeyInZone(new Date(), timeZone)
  const [picked, setPicked] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const day = picked ?? today
  const appointments = useWhatsAppSchedAppointments(workspaceId, {
    from: day,
    to: day,
  })

  if (settings.data && !settings.data.enabled) {
    return (
      <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
        O agendamento está desligado. Um administrador ativa em Configurações.
      </p>
    )
  }

  return (
    <div className='max-w-3xl space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            aria-label='Dia anterior'
            onClick={() => setPicked(addDays(day, -1))}
          >
            {'<'}
          </Button>
          <Input
            type='date'
            aria-label='Dia da agenda'
            className='w-40'
            value={day}
            onChange={(event) => setPicked(event.target.value || null)}
          />
          <Button
            size='sm'
            variant='outline'
            aria-label='Próximo dia'
            onClick={() => setPicked(addDays(day, 1))}
          >
            {'>'}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setPicked(null)}>
            Hoje
          </Button>
        </div>
        <Button onClick={() => setCreating(true)}>Novo agendamento</Button>
      </div>
      <h2 className='font-medium capitalize'>{formatDayLabel(day)}</h2>

      {appointments.isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : (appointments.data ?? []).length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhum agendamento neste dia.
        </p>
      ) : (
        <ul className='space-y-2'>
          {appointments.data?.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              workspaceId={workspaceId}
              appointment={appointment}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}

      <NewAppointmentDialog
        workspaceId={workspaceId}
        timeZone={timeZone}
        today={today}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  )
}
