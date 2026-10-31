'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  useCreateSchedAppointment,
  useWhatsAppSchedProfessionals,
  useWhatsAppSchedServices,
  useWhatsAppSchedSlots,
} from '@/src/hooks/use-whatsapp-scheduling'
import { SimpleSelect } from '../chatbots/chatbot-select'
import { formatTimeInZone } from './scheduling-labels'

const ANY = '__any'

function Form({
  workspaceId,
  timeZone,
  today,
  onClose,
}: {
  workspaceId: string
  timeZone: string
  today: string
  onClose: () => void
}) {
  const services = useWhatsAppSchedServices(workspaceId)
  const professionals = useWhatsAppSchedProfessionals(workspaceId)
  const create = useCreateSchedAppointment(workspaceId)
  const [search, setSearch] = useState('')
  const contacts = useWhatsAppContacts(workspaceId, search || undefined)
  const [contactId, setContactId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState(ANY)
  const [date, setDate] = useState(today)
  const [startsAt, setStartsAt] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const slots = useWhatsAppSchedSlots(
    workspaceId,
    {
      serviceId,
      date,
      professionalId: professionalId === ANY ? undefined : professionalId,
    },
    Boolean(serviceId),
  )
  const eligible = (professionals.data ?? []).filter(
    (p) => p.active && p.serviceIds.includes(serviceId),
  )
  const chosen = (slots.data ?? []).find(
    (slot) => `${slot.startsAt}|${slot.professionalId}` === startsAt,
  )

  function submit() {
    if (!chosen) return
    setError(null)
    create.mutate(
      {
        serviceId,
        professionalId: chosen.professionalId,
        contactId,
        startsAt: chosen.startsAt,
        notes: notes.trim() || undefined,
        notify: true,
      },
      {
        onSuccess: () => {
          notify.success('Agendamento criado')
          onClose()
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <>
      <div className='space-y-1.5'>
        <Label htmlFor='apptContactSearch'>Cliente</Label>
        <Input
          id='apptContactSearch'
          placeholder='Buscar contato pelo nome ou número'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SimpleSelect
          ariaLabel='Cliente'
          value={contactId}
          placeholder='Escolha o contato'
          options={(contacts.data ?? []).slice(0, 50).map((contact) => ({
            value: contact.id,
            label: contact.name ?? contact.waId,
          }))}
          onChange={setContactId}
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Serviço</Label>
        <SimpleSelect
          ariaLabel='Serviço'
          value={serviceId}
          placeholder='Escolha o serviço'
          options={(services.data ?? [])
            .filter((service) => service.active)
            .map((service) => ({ value: service.id, label: service.name }))}
          onChange={(value) => {
            setServiceId(value)
            setProfessionalId(ANY)
            setStartsAt('')
          }}
        />
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <Label>Profissional</Label>
          <SimpleSelect
            ariaLabel='Profissional'
            value={professionalId}
            options={[
              { value: ANY, label: 'Qualquer um' },
              ...eligible.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(value) => {
              setProfessionalId(value)
              setStartsAt('')
            }}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='apptDate'>Dia</Label>
          <Input
            id='apptDate'
            type='date'
            min={today}
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setStartsAt('')
            }}
          />
        </div>
      </div>
      <div className='space-y-1.5'>
        <Label>Horários livres</Label>
        <div className='flex max-h-32 flex-wrap gap-2 overflow-y-auto'>
          {!serviceId ? (
            <span className='text-muted-foreground text-xs'>
              Escolha o serviço para ver os horários.
            </span>
          ) : slots.isLoading ? (
            <span className='text-muted-foreground text-xs'>Buscando...</span>
          ) : (slots.data ?? []).length === 0 ? (
            <span className='text-muted-foreground text-xs'>
              Sem horário livre neste dia.
            </span>
          ) : (
            slots.data?.map((slot) => {
              const key = `${slot.startsAt}|${slot.professionalId}`
              return (
                <Button
                  key={key}
                  type='button'
                  size='sm'
                  variant={startsAt === key ? 'default' : 'outline'}
                  onClick={() => setStartsAt(key)}
                >
                  {formatTimeInZone(slot.startsAt, timeZone)}
                  {professionalId === ANY ? ` ${slot.professionalName}` : ''}
                </Button>
              )
            })
          )}
        </div>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='apptNotes'>Observações</Label>
        <Textarea
          id='apptNotes'
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      {error ? <p className='text-destructive text-sm'>{error}</p> : null}
      <DialogFooter>
        <Button variant='outline' onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={submit}
          disabled={create.isPending || !chosen || !contactId}
        >
          {create.isPending ? 'Agendando...' : 'Agendar'}
        </Button>
      </DialogFooter>
    </>
  )
}

export function NewAppointmentDialog({
  workspaceId,
  timeZone,
  today,
  open,
  onOpenChange,
}: {
  workspaceId: string
  timeZone: string
  today: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>
            O cliente recebe a confirmação pelo WhatsApp e responde CONFIRMAR ou
            CANCELAR.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <Form
            workspaceId={workspaceId}
            timeZone={timeZone}
            today={today}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
