'use client'

import {
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdConfigList,
  useSdConfigMutations,
} from '@/src/hooks/use-sd-config'
import type {
  CreateSdEscalationRuleDTO,
  UpdateSdEscalationRuleDTO,
} from '@/src/schemas/sd-escalation-rule.schema'
import type {
  SdCondition,
  SdEscalationActions,
} from '@/src/schemas/sd-rule.schema'
import type {
  SdEscalationRuleDTO,
  SdEscalationTriggerDTO,
} from '@/types/sd-config'
import { SdNlConfigButton } from './nl-config-dialog'
import {
  SD_DEFAULT_ESCALATION_ACTIONS,
  SdConditionBuilder,
  SdEscalationActionsEditor,
  summarizeSdConditions,
  summarizeSdEscalationActions,
  validateSdConditions,
  validateSdEscalationActions,
} from './rule-builders'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  NumberInput,
  SettingsSection,
  SimpleSelect,
  SortableList,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

export const SD_ESCALATION_TRIGGER_OPTIONS: {
  value: SdEscalationTriggerDTO
  label: string
}[] = [
  { value: 'FIRST_RESPONSE_AT_RISK', label: 'Primeira resposta em risco' },
  { value: 'FIRST_RESPONSE_BREACHED', label: 'Primeira resposta violada' },
  { value: 'RESOLUTION_AT_RISK', label: 'Resolução em risco' },
  { value: 'RESOLUTION_BREACHED', label: 'Resolução violada' },
  { value: 'NO_UPDATE', label: 'Sem atualização' },
]

const TRIGGER_LABEL = Object.fromEntries(
  SD_ESCALATION_TRIGGER_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SdEscalationTriggerDTO, string>

type Editing = SdEscalationRuleDTO | 'new' | null

export function SdEscalationTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const { data, isLoading } = useSdConfigList<SdEscalationRuleDTO>(
    workspaceId,
    'escalation-rules',
  )
  const mutations = useSdConfigMutations<
    SdEscalationRuleDTO,
    CreateSdEscalationRuleDTO,
    UpdateSdEscalationRuleDTO
  >(workspaceId, 'escalation-rules')
  const [editing, setEditing] = useState<Editing>(null)
  const rules = data ?? []

  async function toggleActive(rule: SdEscalationRuleDTO, active: boolean) {
    try {
      await mutations.update.mutateAsync({ id: rule.id, data: { active } })
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Regras de escalonamento'
      description='Avaliadas pelo relógio de SLA do worker, na ordem da lista. "Em risco" usa o percentual de Geral > SLA em risco.'
      actions={
        canEdit ? (
          <>
            <SdNlConfigButton
              workspaceId={workspaceId}
              kind='ESCALATION'
              existing={data ?? []}
            />
            <Button size='sm' onClick={() => setEditing('new')}>
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Nova regra
            </Button>
          </>
        ) : null
      }
    >
      {!isLoading && rules.length === 0 ? (
        <EmptyState>Nenhuma regra de escalonamento.</EmptyState>
      ) : (
        <SortableList
          items={rules}
          disabled={!canEdit}
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
                  <Badge variant='outline'>
                    {TRIGGER_LABEL[rule.trigger]}
                    {rule.trigger === 'NO_UPDATE' && rule.thresholdMinutes
                      ? ` · ${rule.thresholdMinutes} min`
                      : ''}
                  </Badge>
                </div>
                <span className='truncate text-xs text-muted-foreground'>
                  Se {summarizeSdConditions(rule.conditions).toLowerCase()} →{' '}
                  {summarizeSdEscalationActions(rule.actions)}
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
                    aria-label={`Editar ${rule.name}`}
                    onClick={() => setEditing(rule)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <ConfirmDeleteButton
                    title='Excluir regra'
                    description={`"${rule.name}" deixará de escalonar chamados. Para pausar, desative.`}
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

      {editing ? (
        <EscalationRuleDialog
          rule={editing === 'new' ? null : editing}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing === 'new') await mutations.create.mutateAsync(data)
              else await mutations.update.mutateAsync({ id: editing.id, data })
              notify.success('Regra salva')
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

function EscalationRuleDialog({
  rule,
  saving,
  onClose,
  onSave,
}: {
  rule: SdEscalationRuleDTO | null
  saving: boolean
  onClose: () => void
  onSave: (data: CreateSdEscalationRuleDTO) => void
}) {
  const [name, setName] = useState(rule?.name ?? '')
  const [trigger, setTrigger] = useState<SdEscalationTriggerDTO>(
    rule?.trigger ?? 'RESOLUTION_AT_RISK',
  )
  const [threshold, setThreshold] = useState<number | null>(
    rule?.thresholdMinutes ?? 120,
  )
  const [conditions, setConditions] = useState<SdCondition[]>(
    rule?.conditions ?? [],
  )
  const [actions, setActions] = useState<SdEscalationActions>(
    rule?.actions ?? SD_DEFAULT_ESCALATION_ACTIONS,
  )
  const [active, setActive] = useState(rule?.active ?? true)

  function submit() {
    if (!name.trim()) return notify.error('Informe o nome da regra')
    if (trigger === 'NO_UPDATE' && !threshold) {
      return notify.error('Informe os minutos sem atualização')
    }
    const problem =
      validateSdConditions(conditions) ?? validateSdEscalationActions(actions)
    if (problem) return notify.error(problem)
    onSave({
      name: name.trim(),
      trigger,
      thresholdMinutes: trigger === 'NO_UPDATE' ? threshold : null,
      conditions,
      actions,
      active,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {rule
              ? 'Editar regra de escalonamento'
              : 'Nova regra de escalonamento'}
          </DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-5'>
          <div className='grid gap-3 md:grid-cols-2'>
            <FieldBlock label='Nome' className='md:col-span-2'>
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label='Gatilho'>
              <SimpleSelect
                value={trigger}
                options={SD_ESCALATION_TRIGGER_OPTIONS}
                onChange={(value) => value && setTrigger(value)}
              />
            </FieldBlock>
            {trigger === 'NO_UPDATE' ? (
              <FieldBlock label='Minutos sem atualização'>
                <NumberInput
                  value={threshold}
                  min={1}
                  max={525600}
                  suffix='min'
                  onCommit={setThreshold}
                />
              </FieldBlock>
            ) : null}
          </div>
          <div className='flex flex-col gap-2'>
            <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Se
            </h4>
            <SdConditionBuilder value={conditions} onChange={setConditions} />
          </div>
          <div className='flex flex-col gap-2'>
            <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Então
            </h4>
            <SdEscalationActionsEditor value={actions} onChange={setActions} />
          </div>
          <ToggleRow
            label='Regra ativa'
            checked={active}
            onCheckedChange={setActive}
          />
        </div>
        <DialogFooter>
          <Button variant='outline' size='sm' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='sm' disabled={saving} onClick={submit}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
