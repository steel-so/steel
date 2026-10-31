'use client'

import {
  Copy01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdConfigList,
  useSdConfigMutations,
} from '@/src/hooks/use-sd-config'
import type {
  CreateSdAutomationRuleDTO,
  UpdateSdAutomationRuleDTO,
} from '@/src/schemas/sd-automation-rule.schema'
import type {
  SdAutomationAction,
  SdCondition,
} from '@/src/schemas/sd-rule.schema'
import type {
  SdAutomationEventDTO,
  SdAutomationRuleDTO,
} from '@/types/sd-config'
import { SdNlConfigButton } from './nl-config-dialog'
import {
  SdAutomationActionsBuilder,
  SdConditionBuilder,
  validateSdAutomationActions,
  validateSdConditions,
} from './rule-builders'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  SettingsSection,
  SimpleSelect,
  SortableList,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

export const SD_AUTOMATION_EVENT_OPTIONS: {
  value: SdAutomationEventDTO
  label: string
}[] = [
  { value: 'TICKET_CREATED', label: 'Chamado aberto' },
  { value: 'TICKET_UPDATED', label: 'Chamado atualizado' },
  { value: 'PHASE_CHANGED', label: 'Fase alterada' },
  { value: 'MESSAGE_RECEIVED', label: 'Mensagem recebida' },
  { value: 'APPROVAL_RESPONDED', label: 'Aprovação respondida' },
  { value: 'SLA_AT_RISK', label: 'SLA em risco' },
  { value: 'SLA_BREACHED', label: 'SLA violado' },
]

const EVENT_LABEL = Object.fromEntries(
  SD_AUTOMATION_EVENT_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SdAutomationEventDTO, string>

const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit)
    }
  }
  return 'agora'
}

type Editing = SdAutomationRuleDTO | 'new' | null

export function SdAutomationsTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const [event, setEvent] = useState<SdAutomationEventDTO | null>(null)
  const { data, isLoading } = useSdConfigList<SdAutomationRuleDTO>(
    workspaceId,
    'automation-rules',
  )
  const mutations = useSdConfigMutations<
    SdAutomationRuleDTO,
    CreateSdAutomationRuleDTO,
    UpdateSdAutomationRuleDTO
  >(workspaceId, 'automation-rules')
  const [editing, setEditing] = useState<Editing>(null)
  const all = data ?? []
  const rules = event ? all.filter((r) => r.event === event) : all

  async function toggleActive(rule: SdAutomationRuleDTO, active: boolean) {
    try {
      await mutations.update.mutateAsync({ id: rule.id, data: { active } })
    } catch (err) {
      notify.error(err)
    }
  }

  async function duplicate(rule: SdAutomationRuleDTO) {
    try {
      await mutations.create.mutateAsync({
        name: `${rule.name} (cópia)`.slice(0, 120),
        description: rule.description,
        event: rule.event,
        conditions: rule.conditions,
        actions: rule.actions,
        stopProcessing: rule.stopProcessing,
        active: false,
      })
      notify.success('Regra duplicada (inativa)')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Regras de automação'
      description='Para cada evento, as regras ativas são avaliadas de cima para baixo; "parar de processar" interrompe as seguintes do mesmo evento.'
      actions={
        canEdit ? (
          <>
            <SdNlConfigButton
              workspaceId={workspaceId}
              kind='AUTOMATION'
              existing={data ?? []}
            />
            <Button size='sm' onClick={() => setEditing('new')}>
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Nova automação
            </Button>
          </>
        ) : null
      }
    >
      <div className='flex flex-wrap gap-1.5'>
        {[
          { value: null, label: 'Todos os eventos' },
          ...SD_AUTOMATION_EVENT_OPTIONS,
        ].map((option) => (
          <button
            key={option.value ?? 'all'}
            type='button'
            aria-pressed={event === option.value}
            onClick={() =>
              setEvent(option.value as SdAutomationEventDTO | null)
            }
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition',
              event === option.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {option.label}
            {option.value
              ? ` (${all.filter((r) => r.event === option.value).length})`
              : ''}
          </button>
        ))}
      </div>

      {!isLoading && rules.length === 0 ? (
        <EmptyState>
          Nenhuma automação{event ? ' para este evento' : ''}.
        </EmptyState>
      ) : (
        <SortableList
          items={rules}
          disabled={!canEdit || event !== null}
          onReorder={(orderedIds) =>
            mutations.reorder.mutate(
              { orderedIds },
              { onError: (err) => notify.error(err) },
            )
          }
          renderItem={(rule, handle) => (
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5',
                !rule.active && 'opacity-60',
              )}
            >
              {handle}
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='truncate text-sm font-medium'>
                    {rule.name}
                  </span>
                  <Badge variant='outline'>{EVENT_LABEL[rule.event]}</Badge>
                  {rule.stopProcessing ? (
                    <Badge variant='secondary'>Para de processar</Badge>
                  ) : null}
                </div>
                {rule.description ? (
                  <span className='truncate text-xs text-muted-foreground'>
                    {rule.description}
                  </span>
                ) : null}
                <span className='text-[11px] text-muted-foreground'>
                  {rule.conditions.length} condição(ões) · {rule.actions.length}{' '}
                  ação(ões)
                  {rule.runCount > 0
                    ? ` · executada ${rule.runCount}×${rule.lastRunAt ? ` · última ${timeAgo(rule.lastRunAt)}` : ''}`
                    : ' · nunca executada'}
                </span>
              </div>
              <Switch
                checked={rule.active}
                disabled={!canEdit}
                onCheckedChange={(value) => toggleActive(rule, value)}
                aria-label={rule.active ? 'Desativar' : 'Ativar'}
              />
              {canEdit ? (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Duplicar ${rule.name}`}
                    onClick={() => duplicate(rule)}
                  >
                    <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Editar ${rule.name}`}
                    onClick={() => setEditing(rule)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <ConfirmDeleteButton
                    title='Excluir automação'
                    description={`"${rule.name}" deixará de rodar. Para pausar, desative.`}
                    pending={mutations.remove.isPending}
                    onConfirm={() =>
                      mutations.remove.mutate(rule.id, {
                        onError: (err) => notify.error(err),
                      })
                    }
                  />
                </>
              ) : null}
            </div>
          )}
        />
      )}
      {event !== null && canEdit ? (
        <p className='text-[11px] text-muted-foreground'>
          Para reordenar, mostre todos os eventos.
        </p>
      ) : null}

      {editing ? (
        <AutomationSheet
          rule={editing === 'new' ? null : editing}
          defaultEvent={event ?? 'TICKET_CREATED'}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing === 'new') await mutations.create.mutateAsync(data)
              else await mutations.update.mutateAsync({ id: editing.id, data })
              notify.success('Automação salva')
              setEditing(null)
            } catch (err) {
              notify.error(err)
            }
          }}
        />
      ) : null}
    </SettingsSection>
  )
}

function Step({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className='flex gap-3'>
      <div className='flex flex-col items-center'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary'>
          {label}
        </span>
        <span className='mt-1 w-px flex-1 bg-border' />
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-2 pb-5'>
        <h4 className='text-sm font-semibold'>{title}</h4>
        {children}
      </div>
    </div>
  )
}

function AutomationSheet({
  rule,
  defaultEvent,
  saving,
  onClose,
  onSave,
}: {
  rule: SdAutomationRuleDTO | null
  defaultEvent: SdAutomationEventDTO
  saving: boolean
  onClose: () => void
  onSave: (data: CreateSdAutomationRuleDTO) => void
}) {
  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [event, setEvent] = useState<SdAutomationEventDTO>(
    rule?.event ?? defaultEvent,
  )
  const [conditions, setConditions] = useState<SdCondition[]>(
    rule?.conditions ?? [],
  )
  const [actions, setActions] = useState<SdAutomationAction[]>(
    rule?.actions ?? [],
  )
  const [stopProcessing, setStopProcessing] = useState(
    rule?.stopProcessing ?? false,
  )
  const [active, setActive] = useState(rule?.active ?? true)

  function submit() {
    if (!name.trim()) return notify.error('Informe o nome da automação')
    const problem =
      validateSdConditions(conditions) ?? validateSdAutomationActions(actions)
    if (problem) return notify.error(problem)
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      event,
      conditions,
      actions,
      stopProcessing,
      active,
    })
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent className='w-full data-[side=right]:sm:max-w-3xl'>
        <SheetHeader>
          <SheetTitle>
            {rule ? 'Editar automação' : 'Nova automação'}
          </SheetTitle>
        </SheetHeader>
        <div className='flex-1 overflow-y-auto px-4'>
          <div className='mb-5 grid gap-3 md:grid-cols-2'>
            <FieldBlock label='Nome' className='md:col-span-2'>
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label='Descrição' className='md:col-span-2'>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldBlock>
          </div>
          <Step label='1' title='Quando'>
            <SimpleSelect
              value={event}
              options={SD_AUTOMATION_EVENT_OPTIONS}
              onChange={(value) => value && setEvent(value)}
              className='md:w-72'
            />
          </Step>
          <Step label='2' title='Se'>
            <SdConditionBuilder value={conditions} onChange={setConditions} />
          </Step>
          <Step label='3' title='Então'>
            <SdAutomationActionsBuilder value={actions} onChange={setActions} />
          </Step>
          <div className='mb-4 flex flex-col gap-1 border-t border-border pt-3'>
            <ToggleRow
              label='Parar de processar'
              description='Não avalia as próximas regras deste evento quando esta rodar.'
              checked={stopProcessing}
              onCheckedChange={setStopProcessing}
            />
            <ToggleRow
              label='Automação ativa'
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
        </div>
        <SheetFooter className='flex-row justify-end border-t border-border'>
          <Button variant='outline' size='sm' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='sm' disabled={saving} onClick={submit}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
