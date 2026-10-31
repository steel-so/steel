'use client'

import { PlusSignIcon, Wrench01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCancelSdMaintenance,
  useCreateSdMaintenance,
  useCreateSdStatusComponent,
  useRemoveSdStatusComponent,
  useSdMaintenances,
  useSdStatusComponents,
  useUpdateSdMaintenance,
  useUpdateSdStatusComponent,
} from '@/src/hooks/use-sd-status-maintenance'
import {
  SD_MAINTENANCE_PHASE_LABEL,
  sdIsoToWallTime,
  sdWallTimeToIso,
} from '@/src/lib/servicedesk/status-maintenance'
import type {
  SdStatusComponentStateDTO,
  SdStatusMaintenanceDTO,
} from '@/types/sd-status-maintenance'
import type { SdStatusPageDTO } from '@/types/sd-status-page'
import { SdConfigItemPicker } from '../pickers'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  SimpleSelect,
  ToggleRow,
} from '../settings/sd-settings-kit'
import { StatusPagePicker } from './sd-major-incident-dialogs'
import {
  formatIncidentDateTime,
  SD_COMPONENT_STATE_OPTIONS,
  SD_INCIDENT_DEFAULT_TIME_ZONE,
  SdComponentStateBadge,
} from './sd-major-incident-meta'

/** Componentes (serviços com estado próprio) de uma página de status. */
export function SdComponentsDialog({
  workspaceId,
  page,
  isAdmin,
  onOpenChange,
}: {
  workspaceId: string
  page: SdStatusPageDTO | null
  isAdmin: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pageId = page?.id ?? ''
  const list = useSdStatusComponents(workspaceId, page?.id ?? null)
  const create = useCreateSdStatusComponent(workspaceId, pageId)
  const update = useUpdateSdStatusComponent(workspaceId, pageId)
  const remove = useRemoveSdStatusComponent(workspaceId, pageId)
  const [name, setName] = useState('')
  const [serviceId, setServiceId] = useState<string | null>(null)

  useEffect(() => {
    if (page) {
      setName('')
      setServiceId(null)
    }
  }, [page])

  async function add() {
    try {
      await create.mutateAsync({
        name: name.trim(),
        ...(serviceId ? { serviceId } : {}),
      })
      setName('')
      setServiceId(null)
      notify.success('Componente adicionado')
    } catch (error) {
      notify.error(error)
    }
  }

  async function setState(id: string, state: SdStatusComponentStateDTO) {
    try {
      await update.mutateAsync({ id, data: { state } })
    } catch (error) {
      notify.error(error)
    }
  }

  const items = list.data?.items ?? []
  const services = page?.services ?? []
  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Componentes · {page?.name}</DialogTitle>
          <DialogDescription>
            Cada componente aparece na página pública com o próprio estado
            (operacional, degradado ou indisponível). O estado geral da página
            considera o pior entre os componentes e os incidentes ativos.
          </DialogDescription>
        </DialogHeader>
        {isAdmin ? (
          <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end'>
            <FieldBlock label='Nome'>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder='Telefonia'
              />
            </FieldBlock>
            <FieldBlock label='Serviço do catálogo (opcional)'>
              <SimpleSelect
                value={serviceId}
                onChange={setServiceId}
                allowEmpty
                options={services.map((s) => ({ value: s.id, label: s.name }))}
              />
            </FieldBlock>
            <Button
              disabled={name.trim().length < 2 || create.isPending}
              onClick={add}
            >
              Adicionar
            </Button>
          </div>
        ) : null}
        {items.length === 0 ? (
          <EmptyState>
            {list.isLoading ? 'Carregando…' : 'Nenhum componente ainda.'}
          </EmptyState>
        ) : (
          <ul className='flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border'>
            {items.map((item) => (
              <li
                key={item.id}
                className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
              >
                <span className='min-w-0 flex-1 truncate'>{item.name}</span>
                <SdComponentStateBadge state={item.state} />
                <div className='w-48'>
                  <SimpleSelect
                    value={item.state}
                    onChange={(value) => value && setState(item.id, value)}
                    options={SD_COMPONENT_STATE_OPTIONS}
                  />
                </div>
                {isAdmin ? (
                  <ConfirmDeleteButton
                    title='Remover componente?'
                    description={`${item.name} deixa de aparecer na página pública.`}
                    label='Remover'
                    pending={remove.isPending}
                    onConfirm={() =>
                      remove
                        .mutateAsync(item.id)
                        .then(() => notify.success('Componente removido'))
                        .catch((error) => notify.error(error))
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface MaintenanceForm {
  title: string
  description: string
  startsAt: string
  endsAt: string
  pageIds: string[]
  notifySubscribers: boolean
  suppressMonitoring: boolean
  configItems: { id: string; name: string }[]
}

const EMPTY_FORM: MaintenanceForm = {
  title: '',
  description: '',
  startsAt: '',
  endsAt: '',
  pageIds: [],
  notifySubscribers: true,
  suppressMonitoring: false,
  configItems: [],
}

function formOf(window: SdStatusMaintenanceDTO | null): MaintenanceForm {
  if (!window) return EMPTY_FORM
  return {
    title: window.title,
    description: window.description ?? '',
    startsAt: sdIsoToWallTime(window.startsAt, SD_INCIDENT_DEFAULT_TIME_ZONE),
    endsAt: sdIsoToWallTime(window.endsAt, SD_INCIDENT_DEFAULT_TIME_ZONE),
    pageIds: window.pages.map((p) => p.id),
    notifySubscribers: window.notifySubscribers,
    suppressMonitoring: window.suppressMonitoring,
    configItems: window.configItems,
  }
}

/** Agendar ou editar uma janela de manutenção. */
export function SdMaintenanceDialog({
  workspaceId,
  window,
  open,
  onOpenChange,
}: {
  workspaceId: string
  /** `null` = nova. */
  window: SdStatusMaintenanceDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateSdMaintenance(workspaceId)
  const update = useUpdateSdMaintenance(workspaceId, window?.id ?? '')
  const [form, setForm] = useState<MaintenanceForm>(EMPTY_FORM)

  useEffect(() => {
    if (open) setForm(formOf(window))
  }, [open, window])

  function set<K extends keyof MaintenanceForm>(
    key: K,
    value: MaintenanceForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const startsAt = sdWallTimeToIso(form.startsAt, SD_INCIDENT_DEFAULT_TIME_ZONE)
  const endsAt = sdWallTimeToIso(form.endsAt, SD_INCIDENT_DEFAULT_TIME_ZONE)
  const invalidWindow = !startsAt || !endsAt || endsAt <= startsAt
  const needsItems = form.suppressMonitoring && form.configItems.length === 0
  const canSave =
    form.title.trim().length >= 3 &&
    form.pageIds.length > 0 &&
    !invalidWindow &&
    !needsItems
  const pending = create.isPending || update.isPending

  async function save() {
    if (!startsAt || !endsAt) return
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      startsAt,
      endsAt,
      pageIds: form.pageIds,
      notifySubscribers: form.notifySubscribers,
      suppressMonitoring: form.suppressMonitoring,
      configItemIds: form.configItems.map((c) => c.id),
    }
    try {
      if (window) await update.mutateAsync(body)
      else await create.mutateAsync(body)
      notify.success(window ? 'Manutenção salva' : 'Manutenção agendada')
      onOpenChange(false)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {window ? 'Editar manutenção' : 'Agendar manutenção'}
          </DialogTitle>
          <DialogDescription>
            Aparece como aviso nas páginas escolhidas e os assinantes recebem um
            aviso. Os horários são de Brasília.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Título (público)'>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={160}
              placeholder='Troca do switch do datacenter'
              autoFocus
            />
          </FieldBlock>
          <FieldBlock label='Descrição (pública, opcional)'>
            <Textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </FieldBlock>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock label='Início'>
              <Input
                type='datetime-local'
                value={form.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
              />
            </FieldBlock>
            <FieldBlock
              label='Término'
              hint={
                form.startsAt && form.endsAt && invalidWindow
                  ? 'O término precisa ser depois do início.'
                  : undefined
              }
            >
              <Input
                type='datetime-local'
                value={form.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
            </FieldBlock>
          </div>
          <FieldBlock label='Páginas de status'>
            <StatusPagePicker
              workspaceId={workspaceId}
              selected={form.pageIds}
              onChange={(ids) => set('pageIds', ids)}
            />
          </FieldBlock>
          <ToggleRow
            label='Avisar os assinantes'
            description='Envia e-mail e WhatsApp ao agendar, ao reagendar e ao cancelar.'
            checked={form.notifySubscribers}
            onCheckedChange={(checked) => set('notifySubscribers', checked)}
          />
          <ToggleRow
            label='Não abrir chamados do monitoramento nesta janela'
            description='Alertas dos itens da CMDB abaixo chegam e ficam registrados, mas não abrem chamado enquanto a janela estiver em andamento. Alertas sem item da CMDB não são afetados.'
            checked={form.suppressMonitoring}
            onCheckedChange={(checked) => set('suppressMonitoring', checked)}
          />
          {form.suppressMonitoring ? (
            <FieldBlock
              label='Itens da CMDB cobertos'
              hint={
                needsItems ? 'Escolha ao menos um item da CMDB.' : undefined
              }
            >
              <div className='flex flex-col gap-2'>
                <SdConfigItemPicker
                  workspaceId={workspaceId}
                  value={null}
                  allowCreate={false}
                  placeholder='Adicionar item…'
                  onChange={(option) => {
                    if (
                      option &&
                      !form.configItems.some((c) => c.id === option.id)
                    ) {
                      set('configItems', [
                        ...form.configItems,
                        { id: option.id, name: option.label },
                      ])
                    }
                  }}
                />
                {form.configItems.length > 0 ? (
                  <ul className='flex flex-wrap gap-1.5'>
                    {form.configItems.map((item) => (
                      <li key={item.id}>
                        <Badge variant='secondary' className='gap-1'>
                          {item.name}
                          <button
                            type='button'
                            aria-label={`Remover ${item.name}`}
                            className='text-muted-foreground hover:text-foreground'
                            onClick={() =>
                              set(
                                'configItems',
                                form.configItems.filter(
                                  (c) => c.id !== item.id,
                                ),
                              )
                            }
                          >
                            ×
                          </button>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </FieldBlock>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canSave || pending} onClick={save}>
            {window ? 'Salvar' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PHASE_VARIANT = {
  SCHEDULED: 'secondary',
  IN_PROGRESS: 'default',
  FINISHED: 'outline',
  CANCELED: 'outline',
} as const

/** Manutenções programadas das páginas de status. */
export function SdMaintenanceSection({ workspaceId }: { workspaceId: string }) {
  const list = useSdMaintenances(workspaceId)
  const cancel = useCancelSdMaintenance(workspaceId)
  const [editing, setEditing] = useState<SdStatusMaintenanceDTO | 'new' | null>(
    null,
  )
  const items = list.data?.items ?? []

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col'>
          <h2 className='font-semibold text-base'>Manutenções programadas</h2>
          <p className='text-muted-foreground text-sm'>
            Avisos de janelas planejadas nas páginas de status, com aviso aos
            assinantes e, se quiser, sem chamados do monitoramento durante a
            janela.
          </p>
        </div>
        <Button variant='outline' onClick={() => setEditing('new')}>
          <SteelIcon icon={PlusSignIcon} />
          Agendar manutenção
        </Button>
      </div>
      {list.error ? (
        <EmptyState>{list.error.message}</EmptyState>
      ) : list.isLoading ? (
        <EmptyState>Carregando…</EmptyState>
      ) : items.length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center'>
          <SteelIcon
            icon={Wrench01Icon}
            className='size-6 text-muted-foreground'
          />
          <p className='text-muted-foreground text-sm'>
            Nenhuma manutenção agendada.
          </p>
        </div>
      ) : (
        <ul className='flex flex-col gap-2'>
          {items.map((item) => {
            const open =
              item.phase === 'SCHEDULED' || item.phase === 'IN_PROGRESS'
            return (
              <li
                key={item.id}
                className='flex flex-col gap-2 rounded-lg border border-border bg-card p-3'
              >
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex min-w-0 flex-wrap items-center gap-2'>
                    <span className='font-medium text-sm'>{item.title}</span>
                    <Badge variant={PHASE_VARIANT[item.phase]}>
                      {SD_MAINTENANCE_PHASE_LABEL[item.phase]}
                    </Badge>
                    {item.suppressMonitoring ? (
                      <Badge variant='outline'>
                        Sem chamados do monitoramento
                      </Badge>
                    ) : null}
                  </div>
                  {open ? (
                    <div className='flex items-center gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setEditing(item)}
                      >
                        Editar
                      </Button>
                      <ConfirmDeleteButton
                        title='Cancelar manutenção?'
                        description='A janela deixa de aparecer nas páginas. Quem já recebeu o aviso recebe um aviso de cancelamento.'
                        label='Cancelar manutenção'
                        iconOnly={false}
                        pending={cancel.isPending}
                        onConfirm={() =>
                          cancel
                            .mutateAsync(item.id)
                            .then(() => notify.success('Manutenção cancelada'))
                            .catch((error) => notify.error(error))
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <p className='text-muted-foreground text-xs'>
                  {formatIncidentDateTime(item.startsAt)} até{' '}
                  {formatIncidentDateTime(item.endsAt)}
                  {item.pages.length > 0
                    ? ` · ${item.pages.map((p) => p.name).join(', ')}`
                    : ''}
                  {item.configItems.length > 0
                    ? ` · Itens: ${item.configItems.map((c) => c.name).join(', ')}`
                    : ''}
                  {item.notify.done
                    ? ` · Aviso enviado a ${item.notify.sent} de ${item.notify.total}`
                    : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <SdMaintenanceDialog
        workspaceId={workspaceId}
        window={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </section>
  )
}
