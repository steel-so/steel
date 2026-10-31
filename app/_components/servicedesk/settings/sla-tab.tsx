'use client'

import {
  Cancel01Icon,
  Download04Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdConfigList,
  useSdConfigMutations,
} from '@/src/hooks/use-sd-config'
import type {
  CreateSdCalendarDTO,
  UpdateSdCalendarDTO,
} from '@/src/schemas/sd-calendar.schema'
import type { SdCondition } from '@/src/schemas/sd-rule.schema'
import type {
  CreateSdSlaPolicyDTO,
  UpdateSdSlaPolicyDTO,
} from '@/src/schemas/sd-sla-policy.schema'
import { SD_SEED_HOLIDAYS } from '@/src/services/sd-seed-data'
import type {
  SdBusinessCalendarDTO,
  SdHolidayDTO,
  SdSlaKindDTO,
  SdSlaPolicyDTO,
  SdWeekDayDTO,
  SdWeeklyScheduleDTO,
} from '@/types/sd-config'
import { SdNlConfigButton } from './nl-config-dialog'
import {
  SdConditionBuilder,
  summarizeSdConditions,
  validateSdConditions,
} from './rule-builders'
import {
  ColorDot,
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  SettingsSection,
  SimpleSelect,
  SortableList,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

// ── Durações ───────────────────────────────────────────────────────────────

type Unit = 'min' | 'h' | 'd'
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 }

/** 30 → "30 min", 240 → "4 h", 1560 → "1 d 2 h". */
export function formatSdMinutes(minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const parts = [
    days ? `${days} d` : '',
    hours ? `${hours} h` : '',
    mins ? `${mins} min` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : '0 min'
}

function splitMinutes(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'd' }
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'h' }
  return { value: minutes, unit: 'min' }
}

function DurationInput({
  minutes,
  onChange,
  disabled,
}: {
  minutes: number
  onChange: (minutes: number) => void
  disabled?: boolean
}) {
  const initial = splitMinutes(minutes)
  const [unit, setUnit] = useState<Unit>(initial.unit)
  const value = Math.round((minutes / UNIT_MINUTES[unit]) * 100) / 100
  return (
    <div className='flex items-center gap-1'>
      <Input
        type='number'
        min={1}
        value={value}
        disabled={disabled}
        className='h-8 w-20'
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n > 0) {
            onChange(Math.max(1, Math.round(n * UNIT_MINUTES[unit])))
          }
        }}
      />
      <SimpleSelect
        value={unit}
        disabled={disabled}
        className='h-8 min-w-20'
        options={[
          { value: 'min', label: 'min' },
          { value: 'h', label: 'horas' },
          { value: 'd', label: 'dias' },
        ]}
        onChange={(next) => next && setUnit(next)}
      />
    </div>
  )
}

export function SdSlaTab() {
  return (
    <div className='flex flex-col gap-5'>
      <PoliciesSection />
      <CalendarsSection />
    </div>
  )
}

// ── Políticas ──────────────────────────────────────────────────────────────

type EditingPolicy = SdSlaPolicyDTO | 'new' | null

function PoliciesSection() {
  const { workspaceId, canEdit, config } = useSdSettingsContext()
  const { data, isLoading } = useSdConfigList<SdSlaPolicyDTO>(
    workspaceId,
    'sla-policies',
  )
  const calendars = useSdConfigList<SdBusinessCalendarDTO>(
    workspaceId,
    'calendars',
  )
  const mutations = useSdConfigMutations<
    SdSlaPolicyDTO,
    CreateSdSlaPolicyDTO,
    UpdateSdSlaPolicyDTO
  >(workspaceId, 'sla-policies')
  const [editing, setEditing] = useState<EditingPolicy>(null)
  const priorities = [...(config?.priorities ?? [])].sort(
    (a, b) => b.level - a.level,
  )
  const calendarName = (id: string | null) =>
    calendars.data?.find((c) => c.id === id)?.name ?? 'Calendário padrão'
  const policies = data ?? []

  return (
    <SettingsSection
      title='Políticas de SLA/OLA'
      description='Na abertura, vale a primeira política ativa (na ordem abaixo) cujas condições casam com o chamado; senão, a padrão. Metas em minutos úteis do calendário.'
      actions={
        canEdit ? (
          <>
            <SdNlConfigButton
              workspaceId={workspaceId}
              kind='SLA'
              existing={policies}
            />
            <Button size='sm' onClick={() => setEditing('new')}>
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Nova política
            </Button>
          </>
        ) : null
      }
    >
      {!isLoading && policies.length === 0 ? (
        <EmptyState>Nenhuma política de SLA.</EmptyState>
      ) : (
        <SortableList
          items={policies}
          disabled={!canEdit}
          onReorder={(orderedIds) =>
            mutations.reorder.mutate(
              { orderedIds },
              { onError: (err) => notify.error(err) },
            )
          }
          renderItem={(policy, handle) => (
            <div
              className={cn(
                'flex gap-3 rounded-lg border border-border bg-background px-3 py-3',
                !policy.active && 'opacity-60',
              )}
            >
              <div className='pt-0.5'>{handle}</div>
              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium'>{policy.name}</span>
                  <Badge variant='outline'>{policy.kind}</Badge>
                  {policy.isDefault ? <Badge>Padrão</Badge> : null}
                  {!policy.active ? (
                    <Badge variant='secondary'>Inativa</Badge>
                  ) : null}
                  <span className='text-xs text-muted-foreground'>
                    · {calendarName(policy.calendarId)}
                  </span>
                </div>
                <span className='text-xs text-muted-foreground'>
                  Quando: {summarizeSdConditions(policy.conditions)}
                </span>
                {policy.targets.length > 0 ? (
                  <div className='overflow-x-auto'>
                    <table className='text-xs'>
                      <thead className='text-muted-foreground'>
                        <tr>
                          <th className='pr-6 text-left font-normal'>
                            Prioridade
                          </th>
                          <th className='pr-6 text-left font-normal'>
                            1ª resposta
                          </th>
                          <th className='text-left font-normal'>Resolução</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priorities
                          .map((p) => ({
                            priority: p,
                            target: policy.targets.find(
                              (t) => t.priorityId === p.id,
                            ),
                          }))
                          .filter((row) => row.target)
                          .map(({ priority, target }) => (
                            <tr key={priority.id}>
                              <td className='pr-6'>
                                <span className='inline-flex items-center gap-1.5'>
                                  <ColorDot color={priority.color} />
                                  {priority.name}
                                </span>
                              </td>
                              <td className='pr-6'>
                                {formatSdMinutes(
                                  target?.firstResponseMinutes ?? 0,
                                )}
                              </td>
                              <td>
                                {formatSdMinutes(
                                  target?.resolutionMinutes ?? 0,
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span className='text-muted-foreground text-xs'>
                    Sem metas definidas.
                  </span>
                )}
              </div>
              {canEdit ? (
                <div className='flex items-start gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Editar ${policy.name}`}
                    onClick={() => setEditing(policy)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <ConfirmDeleteButton
                    title='Excluir política'
                    description={`"${policy.name}" deixa de existir; chamados que a usavam ficam sem política. A política padrão não pode ser excluída.`}
                    pending={mutations.remove.isPending}
                    onConfirm={() =>
                      mutations.remove.mutate(policy.id, {
                        onError: (err) => notify.error(err),
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          )}
        />
      )}

      {editing ? (
        <PolicyDialog
          policy={editing === 'new' ? null : editing}
          calendars={calendars.data ?? []}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing === 'new') await mutations.create.mutateAsync(data)
              else await mutations.update.mutateAsync({ id: editing.id, data })
              notify.success('Política salva')
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

type TargetDraft = {
  enabled: boolean
  firstResponseMinutes: number
  resolutionMinutes: number
}

function PolicyDialog({
  policy,
  calendars,
  saving,
  onClose,
  onSave,
}: {
  policy: SdSlaPolicyDTO | null
  calendars: SdBusinessCalendarDTO[]
  saving: boolean
  onClose: () => void
  onSave: (data: CreateSdSlaPolicyDTO) => void
}) {
  const { config } = useSdSettingsContext()
  const priorities = [...(config?.priorities ?? [])].sort(
    (a, b) => b.level - a.level,
  )
  const [name, setName] = useState(policy?.name ?? '')
  const [description, setDescription] = useState(policy?.description ?? '')
  const [kind, setKind] = useState<SdSlaKindDTO>(policy?.kind ?? 'SLA')
  const [calendarId, setCalendarId] = useState<string | null>(
    policy?.calendarId ?? null,
  )
  const [active, setActive] = useState(policy?.active ?? true)
  const [isDefault, setIsDefault] = useState(policy?.isDefault ?? false)
  const [conditions, setConditions] = useState<SdCondition[]>(
    policy?.conditions ?? [],
  )
  const [targets, setTargets] = useState<Record<string, TargetDraft>>(() =>
    Object.fromEntries(
      priorities.map((p) => {
        const t = policy?.targets.find((x) => x.priorityId === p.id)
        return [
          p.id,
          {
            enabled: !!t || !policy,
            firstResponseMinutes: t?.firstResponseMinutes ?? 60,
            resolutionMinutes: t?.resolutionMinutes ?? 480,
          },
        ]
      }),
    ),
  )

  function setTarget(id: string, patch: Partial<TargetDraft>) {
    setTargets((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function submit() {
    if (!name.trim()) return notify.error('Informe o nome da política')
    const problem = validateSdConditions(conditions)
    if (problem) return notify.error(problem)
    const list = Object.entries(targets)
      .filter(([, t]) => t.enabled)
      .map(([priorityId, t]) => ({
        priorityId,
        firstResponseMinutes: t.firstResponseMinutes,
        resolutionMinutes: t.resolutionMinutes,
      }))
    const invalid = list.find(
      (t) => t.resolutionMinutes < t.firstResponseMinutes,
    )
    if (invalid) {
      return notify.error(
        'A meta de resolução não pode ser menor que a de primeira resposta',
      )
    }
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      kind,
      calendarId,
      conditions,
      isDefault,
      active,
      targets: list,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {policy ? 'Editar política' : 'Nova política'}
          </DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-5'>
          <div className='grid gap-3 md:grid-cols-3'>
            <FieldBlock label='Nome' className='md:col-span-2'>
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label='Tipo'>
              <SimpleSelect
                value={kind}
                options={[
                  { value: 'SLA', label: 'SLA (com o cliente)' },
                  { value: 'OLA', label: 'OLA (interno)' },
                ]}
                onChange={(value) => value && setKind(value)}
              />
            </FieldBlock>
            <FieldBlock label='Descrição' className='md:col-span-2'>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label='Calendário'>
              <SimpleSelect
                value={calendarId}
                allowEmpty
                emptyLabel='Calendário padrão'
                options={calendars.map((c) => ({ value: c.id, label: c.name }))}
                onChange={setCalendarId}
              />
            </FieldBlock>
          </div>
          <div className='grid gap-x-6 sm:grid-cols-2'>
            <ToggleRow
              label='Política ativa'
              checked={active}
              onCheckedChange={setActive}
            />
            <ToggleRow
              label='Política padrão'
              description='Usada quando nenhuma outra casa.'
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Aplica-se quando
            </h4>
            <SdConditionBuilder value={conditions} onChange={setConditions} />
          </div>
          <div className='flex flex-col gap-2'>
            <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Metas por prioridade
            </h4>
            {priorities.length === 0 ? (
              <EmptyState>Cadastre prioridades na aba Prioridades.</EmptyState>
            ) : (
              <div className='overflow-x-auto rounded-lg border border-border'>
                <table className='w-full text-sm'>
                  <thead className='bg-muted/50 text-xs text-muted-foreground'>
                    <tr>
                      <th className='px-3 py-2 text-left font-medium'>
                        Prioridade
                      </th>
                      <th className='px-3 py-2 text-left font-medium'>
                        1ª resposta
                      </th>
                      <th className='px-3 py-2 text-left font-medium'>
                        Resolução
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorities.map((p) => {
                      const t = targets[p.id]
                      return (
                        <tr key={p.id} className='border-t border-border'>
                          <td className='px-3 py-2'>
                            <div className='flex items-center gap-2'>
                              <Checkbox
                                checked={t.enabled}
                                onCheckedChange={(v) =>
                                  setTarget(p.id, { enabled: !!v })
                                }
                              />
                              <ColorDot color={p.color} />
                              {p.name}
                            </div>
                          </td>
                          <td className='px-3 py-2'>
                            <DurationInput
                              minutes={t.firstResponseMinutes}
                              disabled={!t.enabled}
                              onChange={(m) =>
                                setTarget(p.id, { firstResponseMinutes: m })
                              }
                            />
                          </td>
                          <td className='px-3 py-2'>
                            <DurationInput
                              minutes={t.resolutionMinutes}
                              disabled={!t.enabled}
                              onChange={(m) =>
                                setTarget(p.id, { resolutionMinutes: m })
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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

// ── Calendários ────────────────────────────────────────────────────────────

const DAYS: { key: SdWeekDayDTO; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
]

const EMPTY_SCHEDULE: SdWeeklyScheduleDTO = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
}

function scheduleSummary(calendar: SdBusinessCalendarDTO): string {
  if (calendar.is24x7) return '24 horas, 7 dias'
  const days = DAYS.filter((d) => calendar.schedule[d.key].length > 0)
  if (days.length === 0) return 'Sem expediente'
  const first = calendar.schedule[days[0].key]
  const hours = first.map(([a, b]) => `${a}–${b}`).join(', ')
  return `${days.map((d) => d.label.slice(0, 3)).join(', ')} · ${hours}`
}

/** Primeiro problema do expediente (ou `null`). */
function scheduleProblem(schedule: SdWeeklyScheduleDTO): string | null {
  for (const day of DAYS) {
    const intervals = [...schedule[day.key]].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )
    for (const [index, [start, end]] of intervals.entries()) {
      if (!start || !end) return `${day.label}: preencha início e fim`
      if (start >= end && end !== '24:00') {
        return `${day.label}: o fim precisa ser depois do início`
      }
      if (index > 0 && start < intervals[index - 1][1]) {
        return `${day.label}: intervalos sobrepostos`
      }
    }
  }
  return null
}

function timezones(): string[] {
  try {
    const all = Intl.supportedValuesOf('timeZone')
    return [
      ...all.filter((z) => z.startsWith('America/')),
      ...all.filter((z) => !z.startsWith('America/')),
    ]
  } catch {
    return ['America/Sao_Paulo']
  }
}

type EditingCalendar = SdBusinessCalendarDTO | 'new' | null

function CalendarsSection() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const { data, isLoading } = useSdConfigList<SdBusinessCalendarDTO>(
    workspaceId,
    'calendars',
  )
  const mutations = useSdConfigMutations<
    SdBusinessCalendarDTO,
    CreateSdCalendarDTO,
    UpdateSdCalendarDTO
  >(workspaceId, 'calendars')
  const [editing, setEditing] = useState<EditingCalendar>(null)
  const calendars = data ?? []

  return (
    <SettingsSection
      title='Calendários de expediente'
      description='Base do relógio de SLA: fuso, horário por dia da semana e feriados. Departamentos e políticas podem apontar para calendários diferentes.'
      actions={
        canEdit ? (
          <Button size='sm' onClick={() => setEditing('new')}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo calendário
          </Button>
        ) : null
      }
    >
      {!isLoading && calendars.length === 0 ? (
        <EmptyState>Nenhum calendário cadastrado.</EmptyState>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {calendars.map((calendar) => (
            <li
              key={calendar.id}
              className='flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5'
            >
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium'>{calendar.name}</span>
                  {calendar.isDefault ? <Badge>Padrão</Badge> : null}
                  {calendar.is24x7 ? (
                    <Badge variant='outline'>24×7</Badge>
                  ) : null}
                </div>
                <span className='truncate text-xs text-muted-foreground'>
                  {calendar.timezone} · {scheduleSummary(calendar)} ·{' '}
                  {calendar.holidays.length} feriado(s)
                </span>
              </div>
              {canEdit ? (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Editar ${calendar.name}`}
                    onClick={() => setEditing(calendar)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <ConfirmDeleteButton
                    title='Excluir calendário'
                    description={`"${calendar.name}" deixa de existir; quem o usava passa ao calendário padrão. O calendário padrão não pode ser excluído.`}
                    pending={mutations.remove.isPending}
                    onConfirm={() =>
                      mutations.remove.mutate(calendar.id, {
                        onError: (err) => notify.error(err),
                      })
                    }
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <CalendarDialog
          calendar={editing === 'new' ? null : editing}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing === 'new') await mutations.create.mutateAsync(data)
              else await mutations.update.mutateAsync({ id: editing.id, data })
              notify.success('Calendário salvo')
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

function CalendarDialog({
  calendar,
  saving,
  onClose,
  onSave,
}: {
  calendar: SdBusinessCalendarDTO | null
  saving: boolean
  onClose: () => void
  onSave: (data: CreateSdCalendarDTO) => void
}) {
  const zones = useMemo(timezones, [])
  const [name, setName] = useState(calendar?.name ?? '')
  const [timezone, setTimezone] = useState(
    calendar?.timezone ?? 'America/Sao_Paulo',
  )
  const [is24x7, setIs24x7] = useState(calendar?.is24x7 ?? false)
  const [isDefault, setIsDefault] = useState(calendar?.isDefault ?? false)
  const [schedule, setSchedule] = useState<SdWeeklyScheduleDTO>(
    calendar?.schedule ?? {
      ...EMPTY_SCHEDULE,
      mon: [['08:00', '18:00']],
      tue: [['08:00', '18:00']],
      wed: [['08:00', '18:00']],
      thu: [['08:00', '18:00']],
      fri: [['08:00', '18:00']],
    },
  )
  const [holidays, setHolidays] = useState<SdHolidayDTO[]>(
    calendar?.holidays ?? [],
  )

  function setDay(day: SdWeekDayDTO, intervals: [string, string][]) {
    setSchedule((prev) => ({ ...prev, [day]: intervals }))
  }

  function copyMondayToWeekdays() {
    setSchedule((prev) => ({
      ...prev,
      tue: prev.mon.map((i) => [...i] as [string, string]),
      wed: prev.mon.map((i) => [...i] as [string, string]),
      thu: prev.mon.map((i) => [...i] as [string, string]),
      fri: prev.mon.map((i) => [...i] as [string, string]),
    }))
  }

  function importNational() {
    const byDate = new Map(holidays.map((h) => [h.date, h]))
    let added = 0
    for (const h of SD_SEED_HOLIDAYS) {
      if (!byDate.has(h.date)) {
        byDate.set(h.date, { ...h })
        added += 1
      }
    }
    setHolidays(
      [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    )
    notify.success(`${added} feriado(s) importado(s)`)
  }

  function submit() {
    if (!name.trim()) return notify.error('Informe o nome do calendário')
    const problem = is24x7 ? null : scheduleProblem(schedule)
    if (problem) return notify.error(problem)
    if (!is24x7 && DAYS.every((d) => schedule[d.key].length === 0)) {
      return notify.error(
        'Defina ao menos um intervalo de expediente (ou marque 24×7)',
      )
    }
    const cleanHolidays = holidays.filter((h) => h.date && h.name.trim())
    if (
      new Set(cleanHolidays.map((h) => h.date)).size !== cleanHolidays.length
    ) {
      return notify.error('Há feriados repetidos na mesma data')
    }
    onSave({
      name: name.trim(),
      timezone,
      schedule: is24x7
        ? {
            mon: [['00:00', '24:00']],
            tue: [['00:00', '24:00']],
            wed: [['00:00', '24:00']],
            thu: [['00:00', '24:00']],
            fri: [['00:00', '24:00']],
            sat: [['00:00', '24:00']],
            sun: [['00:00', '24:00']],
          }
        : schedule,
      holidays: cleanHolidays.map((h) => ({ ...h, name: h.name.trim() })),
      is24x7,
      isDefault,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {calendar ? 'Editar calendário' : 'Novo calendário'}
          </DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-5'>
          <div className='grid gap-3 md:grid-cols-2'>
            <FieldBlock label='Nome'>
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldBlock>
            <FieldBlock label='Fuso horário'>
              <SimpleSelect
                value={timezone}
                options={zones.map((z) => ({
                  value: z,
                  label: z.replaceAll('_', ' '),
                }))}
                onChange={(value) => value && setTimezone(value)}
              />
            </FieldBlock>
          </div>
          <div className='grid gap-x-6 sm:grid-cols-2'>
            <ToggleRow
              label='24×7'
              description='Relógio corre o tempo todo, inclusive feriados.'
              checked={is24x7}
              onCheckedChange={setIs24x7}
            />
            <ToggleRow
              label='Calendário padrão'
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          {!is24x7 ? (
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                  Expediente semanal
                </h4>
                <Button
                  type='button'
                  variant='ghost'
                  size='xs'
                  onClick={copyMondayToWeekdays}
                >
                  Copiar segunda para os dias úteis
                </Button>
              </div>
              <div className='flex flex-col divide-y divide-border rounded-lg border border-border'>
                {DAYS.map((day) => {
                  const intervals = schedule[day.key]
                  return (
                    <div
                      key={day.key}
                      className='flex flex-wrap items-center gap-2 px-3 py-2'
                    >
                      <span className='w-20 text-sm'>{day.label}</span>
                      <div className='flex flex-1 flex-wrap items-center gap-2'>
                        {intervals.length === 0 ? (
                          <span className='text-xs text-muted-foreground'>
                            Fechado
                          </span>
                        ) : null}
                        {intervals.map(([start, end], index) => (
                          <div
                            key={index}
                            className='flex items-center gap-1 rounded-md border border-border px-1.5 py-1'
                          >
                            <input
                              type='time'
                              value={start}
                              aria-label={`${day.label} início`}
                              className='bg-transparent text-sm outline-none'
                              onChange={(e) =>
                                setDay(
                                  day.key,
                                  intervals.map((iv, i) =>
                                    i === index ? [e.target.value, iv[1]] : iv,
                                  ),
                                )
                              }
                            />
                            <span className='text-muted-foreground'>–</span>
                            <input
                              type='time'
                              value={end === '24:00' ? '23:59' : end}
                              aria-label={`${day.label} fim`}
                              className='bg-transparent text-sm outline-none'
                              onChange={(e) =>
                                setDay(
                                  day.key,
                                  intervals.map((iv, i) =>
                                    i === index
                                      ? [
                                          iv[0],
                                          e.target.value === '23:59'
                                            ? '24:00'
                                            : e.target.value,
                                        ]
                                      : iv,
                                  ),
                                )
                              }
                            />
                            <button
                              type='button'
                              aria-label='Remover intervalo'
                              className='text-muted-foreground hover:text-destructive'
                              onClick={() =>
                                setDay(
                                  day.key,
                                  intervals.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <SteelIcon
                                icon={Cancel01Icon}
                                strokeWidth={2}
                                size={14}
                              />
                            </button>
                          </div>
                        ))}
                        <Button
                          type='button'
                          variant='ghost'
                          size='xs'
                          disabled={intervals.length >= 6}
                          onClick={() => {
                            const last = intervals.at(-1)
                            setDay(day.key, [
                              ...intervals,
                              last
                                ? [
                                    last[1] >= '23:00' ? '23:00' : last[1],
                                    '23:59',
                                  ]
                                : ['08:00', '18:00'],
                            ])
                          }}
                        >
                          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                          Intervalo
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {scheduleProblem(schedule) ? (
                <p className='text-xs text-destructive'>
                  {scheduleProblem(schedule)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Feriados ({holidays.length})
              </h4>
              <div className='flex gap-1'>
                <Button
                  type='button'
                  variant='ghost'
                  size='xs'
                  onClick={importNational}
                >
                  <SteelIcon icon={Download04Icon} strokeWidth={2} />
                  Importar feriados nacionais 2026–2027
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='xs'
                  onClick={() =>
                    setHolidays([
                      ...holidays,
                      { date: '', name: '', recurring: false },
                    ])
                  }
                >
                  <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                  Feriado
                </Button>
              </div>
            </div>
            {holidays.length === 0 ? (
              <EmptyState>Nenhum feriado.</EmptyState>
            ) : (
              <div className='flex max-h-72 flex-col gap-1.5 overflow-y-auto'>
                {holidays.map((holiday, index) => (
                  <div key={index} className='flex items-center gap-2'>
                    <Input
                      type='date'
                      value={holiday.date}
                      className='h-8 w-40'
                      onChange={(e) =>
                        setHolidays(
                          holidays.map((h, i) =>
                            i === index ? { ...h, date: e.target.value } : h,
                          ),
                        )
                      }
                    />
                    <Input
                      value={holiday.name}
                      placeholder='Nome'
                      maxLength={120}
                      className='h-8 flex-1'
                      onChange={(e) =>
                        setHolidays(
                          holidays.map((h, i) =>
                            i === index ? { ...h, name: e.target.value } : h,
                          ),
                        )
                      }
                    />
                    <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                      <Switch
                        size='sm'
                        checked={holiday.recurring}
                        onCheckedChange={(v) =>
                          setHolidays(
                            holidays.map((h, i) =>
                              i === index ? { ...h, recurring: v } : h,
                            ),
                          )
                        }
                      />
                      Todo ano
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      aria-label='Remover feriado'
                      onClick={() =>
                        setHolidays(holidays.filter((_, i) => i !== index))
                      }
                    >
                      <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
