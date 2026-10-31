'use client'

import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateSchedService,
  useDeleteSchedService,
  useUpdateSchedService,
  useWhatsAppSchedServices,
} from '@/src/hooks/use-whatsapp-scheduling'
import type { WhatsAppSchedServiceDTO } from '@/types/whatsapp-scheduling'

function ServiceRow({
  workspaceId,
  service,
  canEdit,
}: {
  workspaceId: string
  service: WhatsAppSchedServiceDTO
  canEdit: boolean
}) {
  const update = useUpdateSchedService(workspaceId)
  const remove = useDeleteSchedService(workspaceId)
  return (
    <li className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
      <div>
        <p className='font-medium text-sm'>
          {service.name}{' '}
          {service.active ? null : (
            <Badge variant='secondary'>Desativado</Badge>
          )}
        </p>
        <p className='text-muted-foreground text-xs'>
          {service.durationMinutes} min
          {service.bufferMinutes > 0
            ? ` + ${service.bufferMinutes} min de intervalo`
            : ''}
        </p>
      </div>
      {canEdit ? (
        <div className='flex items-center gap-3'>
          <Switch
            aria-label={`Serviço ${service.name} ativo`}
            checked={service.active}
            disabled={update.isPending}
            onCheckedChange={(active) =>
              update.mutate(
                { id: service.id, data: { active } },
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
              remove.mutate(service.id, {
                onError: (error) =>
                  notify.error(error, 'Não foi possível excluir o serviço'),
              })
            }
          >
            Excluir
          </Button>
        </div>
      ) : null}
    </li>
  )
}

export function ServicesPanel({ workspaceId }: { workspaceId: string }) {
  const canEdit = useIsPrivileged()
  const services = useWhatsAppSchedServices(workspaceId)
  const create = useCreateSchedService(workspaceId)
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('30')
  const [buffer, setBuffer] = useState('0')

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      {
        name,
        durationMinutes: Number.parseInt(duration, 10) || 0,
        bufferMinutes: Number.parseInt(buffer, 10) || 0,
      },
      {
        onSuccess: () => {
          setName('')
          notify.success('Serviço criado')
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <div className='max-w-2xl space-y-4'>
      {canEdit ? (
        <form
          onSubmit={submit}
          className='flex flex-wrap items-end gap-3 rounded-md border p-3'
        >
          <div className='min-w-48 flex-1 space-y-1.5'>
            <Label htmlFor='serviceName'>Novo serviço</Label>
            <Input
              id='serviceName'
              value={name}
              maxLength={80}
              placeholder='Ex.: Corte de cabelo'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='serviceDuration'>Duração (min)</Label>
            <Input
              id='serviceDuration'
              type='number'
              min={5}
              className='w-24'
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='serviceBuffer'>Intervalo (min)</Label>
            <Input
              id='serviceBuffer'
              type='number'
              min={0}
              className='w-24'
              value={buffer}
              onChange={(event) => setBuffer(event.target.value)}
            />
          </div>
          <Button type='submit' disabled={create.isPending || !name.trim()}>
            Adicionar
          </Button>
        </form>
      ) : null}

      {services.isLoading ? (
        <Skeleton className='h-20 w-full' />
      ) : (services.data ?? []).length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhum serviço cadastrado.
        </p>
      ) : (
        <ul className='space-y-2'>
          {services.data?.map((service) => (
            <ServiceRow
              key={service.id}
              workspaceId={workspaceId}
              service={service}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
