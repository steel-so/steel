'use client'

import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateSchedProfessional,
  useDeleteSchedProfessional,
  useUpdateSchedProfessional,
  useWhatsAppSchedProfessionals,
  useWhatsAppSchedServices,
} from '@/src/hooks/use-whatsapp-scheduling'
import type {
  WhatsAppSchedProfessionalDTO,
  WhatsAppSchedServiceDTO,
  WhatsAppSchedWeeklyHoursDTO,
} from '@/types/whatsapp-scheduling'
import { WorkingHoursEditor } from './working-hours-editor'

const WEEKDAY_DEFAULT: WhatsAppSchedWeeklyHoursDTO = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((day) => [
    day,
    [{ start: '09:00', end: '18:00' }],
  ]),
)

function ServicePicker({
  services,
  value,
  onChange,
  disabled,
}: {
  services: WhatsAppSchedServiceDTO[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}) {
  return (
    <div className='flex flex-wrap gap-x-4 gap-y-2'>
      {services.map((service) => (
        <label
          key={service.id}
          htmlFor={`prof-svc-${service.id}`}
          className='flex items-center gap-2 text-sm'
        >
          <Checkbox
            id={`prof-svc-${service.id}`}
            checked={value.includes(service.id)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...value, service.id]
                  : value.filter((id) => id !== service.id),
              )
            }
          />
          {service.name}
        </label>
      ))}
      {services.length === 0 ? (
        <span className='text-muted-foreground text-xs'>
          Cadastre os serviços primeiro.
        </span>
      ) : null}
    </div>
  )
}

function ProfessionalCard({
  workspaceId,
  professional,
  services,
  canEdit,
}: {
  workspaceId: string
  professional: WhatsAppSchedProfessionalDTO
  services: WhatsAppSchedServiceDTO[]
  canEdit: boolean
}) {
  const update = useUpdateSchedProfessional(workspaceId)
  const remove = useDeleteSchedProfessional(workspaceId)
  const [hours, setHours] = useState(professional.workingHours)
  const [serviceIds, setServiceIds] = useState(professional.serviceIds)

  return (
    <li className='space-y-3 rounded-md border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='font-medium'>
          {professional.name}{' '}
          {professional.active ? null : (
            <Badge variant='secondary'>Desativado</Badge>
          )}
        </p>
        {canEdit ? (
          <div className='flex items-center gap-3'>
            <Switch
              aria-label={`Profissional ${professional.name} ativo`}
              checked={professional.active}
              disabled={update.isPending}
              onCheckedChange={(active) =>
                update.mutate(
                  { id: professional.id, data: { active } },
                  {
                    onError: (error) =>
                      notify.error(error, 'Não foi possível atualizar'),
                  },
                )
              }
            />
            <Button
              size='sm'
              variant='outline'
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(professional.id, {
                  onError: (error) =>
                    notify.error(error, 'Não foi possível excluir'),
                })
              }
            >
              Excluir
            </Button>
          </div>
        ) : null}
      </div>
      <div className='space-y-1.5'>
        <Label>Serviços que atende</Label>
        <ServicePicker
          services={services}
          value={serviceIds}
          onChange={setServiceIds}
          disabled={!canEdit}
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Horário de atendimento</Label>
        <WorkingHoursEditor
          value={hours}
          onChange={setHours}
          disabled={!canEdit}
        />
      </div>
      {canEdit ? (
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                id: professional.id,
                data: { workingHours: hours, serviceIds },
              },
              {
                onSuccess: () => notify.success('Profissional salvo'),
                onError: (error) =>
                  notify.error(error, 'Não foi possível salvar'),
              },
            )
          }
        >
          Salvar horários e serviços
        </Button>
      ) : null}
    </li>
  )
}

export function ProfessionalsPanel({ workspaceId }: { workspaceId: string }) {
  const canEdit = useIsPrivileged()
  const professionals = useWhatsAppSchedProfessionals(workspaceId)
  const services = useWhatsAppSchedServices(workspaceId)
  const create = useCreateSchedProfessional(workspaceId)
  const [name, setName] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      {
        name,
        workingHours: WEEKDAY_DEFAULT,
        serviceIds: (services.data ?? [])
          .filter((service) => service.active)
          .map((service) => service.id),
      },
      {
        onSuccess: () => {
          setName('')
          notify.success('Profissional criado')
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <div className='max-w-3xl space-y-4'>
      {canEdit ? (
        <form
          onSubmit={submit}
          className='flex flex-wrap items-end gap-3 rounded-md border p-3'
        >
          <div className='min-w-48 flex-1 space-y-1.5'>
            <Label htmlFor='professionalName'>Novo profissional</Label>
            <Input
              id='professionalName'
              value={name}
              maxLength={80}
              placeholder='Ex.: Dra. Ana'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type='submit' disabled={create.isPending || !name.trim()}>
            Adicionar
          </Button>
        </form>
      ) : null}

      {professionals.isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : (professionals.data ?? []).length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhum profissional cadastrado. Ao criar, ele já atende os serviços
          ativos de segunda a sexta, das 9h às 18h; ajuste abaixo.
        </p>
      ) : (
        <ul className='space-y-3'>
          {professionals.data?.map((professional) => (
            <ProfessionalCard
              key={professional.id}
              workspaceId={workspaceId}
              professional={professional}
              services={services.data ?? []}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
