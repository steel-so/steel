'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateCrmMeetingPage,
  useCrmMeetingHostOptions,
  useUpdateCrmMeetingPage,
} from '@/src/hooks/use-crm-meetings'
import type { CrmMeetingFormat, CrmMeetingPageDTO } from '@/types/crm-meeting'
import { COMMON_TIMEZONES, FORMAT_LABEL } from './meeting-labels'

interface FormState {
  title: string
  slug: string
  description: string
  durationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  slotStepMinutes: number
  timezone: string
  format: CrmMeetingFormat
  location: string
  reminderMinutes: number
  active: boolean
  hostUserIds: string[]
}

const EMPTY: FormState = {
  title: '',
  slug: '',
  description: '',
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 120,
  maxDaysAhead: 30,
  slotStepMinutes: 30,
  timezone: 'America/Sao_Paulo',
  format: 'ONLINE',
  location: '',
  reminderMinutes: 60,
  active: true,
  hostUserIds: [],
}

function fromPage(page: CrmMeetingPageDTO): FormState {
  return {
    title: page.title,
    slug: page.slug,
    description: page.description ?? '',
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes,
    minNoticeMinutes: page.minNoticeMinutes,
    maxDaysAhead: page.maxDaysAhead,
    slotStepMinutes: page.slotStepMinutes,
    timezone: page.timezone,
    format: page.format,
    location: page.location ?? '',
    reminderMinutes: page.reminderMinutes,
    active: page.active,
    hostUserIds: page.hosts.map((host) => host.userId),
  }
}

const FORMAT_ITEMS = (Object.keys(FORMAT_LABEL) as CrmMeetingFormat[]).map(
  (value) => ({ value, label: FORMAT_LABEL[value] }),
)
const TIMEZONE_ITEMS = COMMON_TIMEZONES.map((value) => ({ value, label: value }))

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type='number'
        inputMode='numeric'
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/** Create / edit a booking page: rules, hosts and the confirmation details. */
export function MeetingPageEditorSheet({
  workspaceId,
  page,
  open,
  onOpenChange,
}: {
  workspaceId: string
  page: CrmMeetingPageDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const members = useCrmMeetingHostOptions(workspaceId)
  const create = useCreateCrmMeetingPage(workspaceId)
  const update = useUpdateCrmMeetingPage(workspaceId)
  const saving = create.isPending || update.isPending

  useEffect(() => {
    if (open) setForm(page ? fromPage(page) : EMPTY)
  }, [open, page])

  const patch = (changes: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...changes }))

  function toggleHost(userId: string, checked: boolean) {
    patch({
      hostUserIds: checked
        ? [...form.hostUserIds, userId]
        : form.hostUserIds.filter((id) => id !== userId),
    })
  }

  function save() {
    const base = {
      title: form.title,
      description: form.description || null,
      durationMinutes: form.durationMinutes,
      bufferMinutes: form.bufferMinutes,
      minNoticeMinutes: form.minNoticeMinutes,
      maxDaysAhead: form.maxDaysAhead,
      slotStepMinutes: form.slotStepMinutes,
      timezone: form.timezone,
      format: form.format,
      location: form.location || null,
      reminderMinutes: form.reminderMinutes,
      active: form.active,
      hostUserIds: form.hostUserIds,
      leadSource: page?.leadSource ?? 'Agendamento de reunião',
    }
    const handlers = {
      onSuccess: () => {
        notify.success(page ? 'Página atualizada' : 'Página criada')
        onOpenChange(false)
      },
      onError: (error: unknown) => notify.error(error),
    }
    if (page) {
      update.mutate(
        { pageId: page.id, ...base, slug: form.slug || undefined },
        handlers,
      )
    } else {
      create.mutate({ ...base, slug: form.slug || undefined }, handlers)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>
            {page ? 'Editar página de agendamento' : 'Nova página de agendamento'}
          </SheetTitle>
          <SheetDescription>
            O cliente escolhe um horário livre e o Steel cria o lead, a reunião
            na agenda e avisa os dois por e-mail.
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-4 px-4 pb-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-title'>Título</Label>
            <Input
              id='meeting-title'
              value={form.title}
              maxLength={120}
              placeholder='Conversa de 30 minutos com vendas'
              onChange={(event) => patch({ title: event.target.value })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-slug'>Endereço</Label>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-sm'>/m/</span>
              <Input
                id='meeting-slug'
                value={form.slug}
                maxLength={60}
                placeholder='gerado a partir do título'
                onChange={(event) => patch({ slug: event.target.value })}
              />
            </div>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-description'>Descrição</Label>
            <Textarea
              id='meeting-description'
              value={form.description}
              maxLength={1000}
              rows={3}
              placeholder='O que o cliente vai tratar na reunião'
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <NumberField
              id='meeting-duration'
              label='Duração (min)'
              value={form.durationMinutes}
              min={10}
              max={240}
              onChange={(durationMinutes) => patch({ durationMinutes })}
            />
            <NumberField
              id='meeting-step'
              label='Intervalo entre horários (min)'
              value={form.slotStepMinutes}
              min={5}
              max={120}
              onChange={(slotStepMinutes) => patch({ slotStepMinutes })}
            />
            <NumberField
              id='meeting-buffer'
              label='Folga entre reuniões (min)'
              value={form.bufferMinutes}
              min={0}
              max={120}
              onChange={(bufferMinutes) => patch({ bufferMinutes })}
            />
            <NumberField
              id='meeting-notice'
              label='Antecedência mínima (min)'
              value={form.minNoticeMinutes}
              min={0}
              max={20160}
              onChange={(minNoticeMinutes) => patch({ minNoticeMinutes })}
            />
            <NumberField
              id='meeting-horizon'
              label='Agendar até (dias)'
              value={form.maxDaysAhead}
              min={1}
              max={180}
              onChange={(maxDaysAhead) => patch({ maxDaysAhead })}
            />
            <NumberField
              id='meeting-reminder'
              label='Lembrete (min antes)'
              hint='0 desliga o lembrete'
              value={form.reminderMinutes}
              min={0}
              max={2880}
              onChange={(reminderMinutes) => patch({ reminderMinutes })}
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label>Formato</Label>
              <Select
                items={FORMAT_ITEMS}
                value={form.format}
                onValueChange={(value) =>
                  patch({ format: value as CrmMeetingFormat })
                }
              >
                <SelectTrigger aria-label='Formato'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>Fuso da página</Label>
              <Select
                items={TIMEZONE_ITEMS}
                value={form.timezone}
                onValueChange={(value) => patch({ timezone: String(value) })}
              >
                <SelectTrigger aria-label='Fuso da página'>
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
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='meeting-location'>Link da chamada ou endereço</Label>
            <Input
              id='meeting-location'
              value={form.location}
              maxLength={300}
              placeholder='https://meet.google.com/…'
              onChange={(event) => patch({ location: event.target.value })}
            />
            <p className='text-muted-foreground text-xs'>
              Vai no e-mail de confirmação e no lembrete.
            </p>
          </div>

          <fieldset className='flex flex-col gap-2'>
            <legend className='mb-1 font-medium text-sm'>Vendedores</legend>
            <p className='text-muted-foreground text-xs'>
              Com mais de um, o Steel distribui em rodízio: quem atendeu há mais
              tempo recebe a próxima reunião.
            </p>
            {(members.data ?? []).map((member) => (
              <label
                key={member.id}
                className='flex items-center gap-2 text-sm'
              >
                <Checkbox
                  checked={form.hostUserIds.includes(member.id)}
                  onCheckedChange={(checked) =>
                    toggleHost(member.id, checked === true)
                  }
                />
                <span>{member.name}</span>
                <span className='text-muted-foreground text-xs'>
                  {member.email}
                </span>
              </label>
            ))}
          </fieldset>

          <label className='flex items-center justify-between gap-2 text-sm'>
            Página ativa
            <Switch
              checked={form.active}
              onCheckedChange={(active) => patch({ active })}
            />
          </label>
        </div>

        <SheetFooter className='flex-row justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={
              saving || form.title.trim().length < 2 || form.hostUserIds.length === 0
            }
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
