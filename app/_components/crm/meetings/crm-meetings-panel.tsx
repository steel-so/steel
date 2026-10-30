'use client'

import {
  CodeIcon,
  Copy01Icon,
  Delete02Icon,
  Link01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  useCancelCrmMeetingBooking,
  useCrmMeetingBookings,
  useCrmMeetingPages,
  useDeleteCrmMeetingPage,
} from '@/src/hooks/use-crm-meetings'
import type { CrmMeetingPageDTO } from '@/types/crm-meeting'
import { MeetingAvailabilityForm } from './meeting-availability-form'
import { embedCode, FORMAT_LABEL, formatWhen, publicUrl } from './meeting-labels'
import { MeetingPageEditorSheet } from './meeting-page-editor-sheet'

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success(done)
  } catch {
    notify.error(null, 'Não foi possível copiar')
  }
}

function PagesTab({ workspaceId }: { workspaceId: string }) {
  const pages = useCrmMeetingPages(workspaceId)
  const remove = useDeleteCrmMeetingPage(workspaceId)
  const [editing, setEditing] = useState<CrmMeetingPageDTO | null>(null)
  const [open, setOpen] = useState(false)

  function archive(page: CrmMeetingPageDTO) {
    if (
      !window.confirm(
        `Remover "${page.title}"? O link deixa de funcionar; os agendamentos já feitos continuam.`,
      )
    ) {
      return
    }
    remove.mutate(page.id, {
      onSuccess: () => notify.success('Página removida'),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='max-w-2xl text-muted-foreground text-sm'>
          Páginas públicas com os horários livres dos vendedores. Cada
          agendamento vira lead, reunião na agenda e e-mail de confirmação, e
          pode ser embutido em landing pages e formulários.
        </p>
        <Button
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <SteelIcon icon={PlusSignIcon} />
          Nova página
        </Button>
      </div>

      {pages.isLoading ? (
        <div className='grid gap-3 md:grid-cols-2'>
          <Skeleton className='h-40' />
          <Skeleton className='h-40' />
        </div>
      ) : pages.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar as páginas.
        </p>
      ) : (pages.data ?? []).length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center'>
          <p className='font-medium'>Nenhuma página de agendamento</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Crie a primeira, defina seus horários na aba “Minha disponibilidade”
            e compartilhe o link.
          </p>
        </div>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2'>
          {pages.data?.map((page) => (
            <li key={page.id} className='flex flex-col gap-3 rounded-xl border p-4'>
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{page.title}</p>
                  <p className='text-muted-foreground text-xs'>
                    /m/{page.slug} · {page.durationMinutes} min ·{' '}
                    {FORMAT_LABEL[page.format]}
                  </p>
                </div>
                <Badge variant={page.active ? 'default' : 'secondary'}>
                  {page.active ? 'Ativa' : 'Pausada'}
                </Badge>
              </div>
              <p className='text-muted-foreground text-sm'>
                {page.hosts.map((host) => host.name).join(', ')}
                {page.hosts.length > 1 ? ' (rodízio)' : ''}
              </p>
              <p className='text-sm'>
                {page.upcomingBookings}{' '}
                {page.upcomingBookings === 1
                  ? 'reunião agendada'
                  : 'reuniões agendadas'}
              </p>
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => copy(publicUrl(page.slug), 'Link copiado')}
                >
                  <SteelIcon icon={Link01Icon} />
                  Copiar link
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    copy(embedCode(page.slug), 'Código de incorporação copiado')
                  }
                >
                  <SteelIcon icon={CodeIcon} />
                  Incorporar
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    setEditing(page)
                    setOpen(true)
                  }}
                >
                  <SteelIcon icon={PencilEdit02Icon} />
                  Editar
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  aria-label={`Remover ${page.title}`}
                  onClick={() => archive(page)}
                  disabled={remove.isPending}
                >
                  <SteelIcon icon={Delete02Icon} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MeetingPageEditorSheet
        workspaceId={workspaceId}
        page={editing}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  )
}

function BookingsTab({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming')
  const bookings = useCrmMeetingBookings(workspaceId, scope)
  const cancel = useCancelCrmMeetingBooking(workspaceId)

  function cancelBooking(id: string, guest: string) {
    if (!window.confirm(`Cancelar a reunião com ${guest}? Ele recebe um aviso por e-mail.`)) {
      return
    }
    cancel.mutate(id, {
      onSuccess: () => notify.success('Reunião cancelada'),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex gap-2'>
        <Button
          size='sm'
          variant={scope === 'upcoming' ? 'default' : 'outline'}
          onClick={() => setScope('upcoming')}
        >
          Próximas
        </Button>
        <Button
          size='sm'
          variant={scope === 'past' ? 'default' : 'outline'}
          onClick={() => setScope('past')}
        >
          Anteriores
        </Button>
      </div>
      {bookings.isLoading ? (
        <Skeleton className='h-32' />
      ) : (bookings.data ?? []).length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhuma reunião {scope === 'upcoming' ? 'agendada' : 'anterior'}.
        </p>
      ) : (
        <ul className='flex flex-col divide-y rounded-lg border'>
          {bookings.data?.map((item) => (
            <li key={item.id} className='flex flex-wrap items-center gap-3 px-3 py-2 text-sm'>
              <span className='w-36 shrink-0 font-medium'>
                {formatWhen(item.startsAt, 'America/Sao_Paulo')}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='font-medium'>{item.guestName}</span>{' '}
                <span className='text-muted-foreground'>
                  {item.guestEmail} · {item.pageTitle} · com {item.hostName}
                </span>
              </span>
              {item.status === 'CANCELED' ? (
                <Badge variant='secondary'>Cancelada</Badge>
              ) : scope === 'upcoming' ? (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => cancelBooking(item.id, item.guestName)}
                  disabled={cancel.isPending}
                >
                  Cancelar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** "Agendamentos" page: booking pages, the meetings booked and my availability. */
export function CrmMeetingsPanel({ workspaceId }: { workspaceId: string }) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4'>
      <Tabs defaultValue='pages'>
        <TabsList>
          <TabsTrigger value='pages'>Páginas</TabsTrigger>
          <TabsTrigger value='bookings'>Reuniões</TabsTrigger>
          <TabsTrigger value='availability'>Minha disponibilidade</TabsTrigger>
        </TabsList>
        <TabsContent value='pages' className='pt-2'>
          <PagesTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value='bookings' className='pt-2'>
          <BookingsTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value='availability' className='pt-2'>
          <MeetingAvailabilityForm workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
