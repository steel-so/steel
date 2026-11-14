'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  FilterIcon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type RefObject, useEffect, useState } from 'react'
import {
  SdConfigItemPicker,
  SdContactPicker,
  SdCustomerPicker,
} from '@/app/_components/servicedesk/pickers'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SD_RISK_LEVEL_LABEL } from '@/src/lib/servicedesk/risk'
import type { SdAgentDTO, SdConfigBootstrapDTO } from '@/types/sd-config'
import type { SdTicketTypeDTO } from '@/types/sd-ticket'
import { SdKbTagsInput } from '../knowledge/sd-kb-tags-input'
import { useDebouncedValue } from '../table/use-sd-table-state'
import { SdOptionSelect, type SdSelectOption } from '../ticket/sd-option-select'
import {
  SD_CHANNEL_LABEL,
  SD_TICKET_TYPE_LABEL,
  SD_TICKET_TYPES,
  sdFormatDate,
} from '../ticket/sd-ticket-meta'
import {
  sdCategoryChildOptions,
  sdCategoryName,
  sdCategoryOptions,
  sdClassificationOptions,
  sdDepartmentOptions,
  sdScaleOptions,
  sdTypePhases,
} from '../ticket/sd-ticket-options'
import {
  SD_BOARD_DEFAULTS,
  SD_QUICK_FILTERS,
  SD_SORT_FIELD_LABEL,
  SD_SORT_FIELDS,
  type SdBoardFilters,
  type SdListGroup,
  type SdSortField,
  sdActiveFilterCount,
  sdNormalizeFilters,
  sdQuickFilterActive,
  sdToggleQuickFilter,
} from './sd-board-state'
import { SD_LIST_GROUP_LABEL } from './sd-list-groups'
import { SdMultiSelect } from './sd-multi-select'

export interface SdFilterChip {
  key: keyof SdBoardFilters
  label: string
  value: string
}

interface ChipLookup {
  config?: SdConfigBootstrapDTO
  agents: SdAgentDTO[]
  /** Rótulos conhecidos dos seletores assíncronos (cliente, contato, CI). */
  pickedLabels?: Record<string, string>
}

/**
 * Short band names for the risk field and its chip. `SD_RISK_LEVEL_LABEL`
 * already says "Risco alto", which next to a "Risco" label reads twice.
 */
const RISK_BANDS: {
  value: NonNullable<SdBoardFilters['riskLevel']>
  label: string
}[] = [
  { value: 'HIGH', label: 'Alto' },
  { value: 'MEDIUM', label: 'Médio' },
  { value: 'LOW', label: 'Baixo' },
]

function names(
  ids: string[] | undefined,
  options: { value: string; label: string }[],
): string {
  return (ids ?? [])
    .map((id) => options.find((o) => o.value === id)?.label ?? id)
    .join(', ')
}

function assigneeName(id: string, agents: SdAgentDTO[]): string {
  if (id === 'me') return 'Eu'
  if (id === 'unassigned') return 'Não atribuído'
  return agents.find((a) => a.id === id)?.name ?? id
}

/** Chips dos filtros ativos (rótulo legível de cada um). */
export function sdFilterChips(
  filters: SdBoardFilters,
  { config, agents, pickedLabels = {} }: ChipLookup,
): SdFilterChip[] {
  const f = sdNormalizeFilters(filters as Record<string, unknown>)
  const phases = (config?.phases ?? []).flatMap((flow) =>
    flow.phases.map((p) => ({ value: p.id, label: p.name })),
  )
  const chips: SdFilterChip[] = []
  const push = (key: keyof SdBoardFilters, label: string, value: string) =>
    chips.push({ key, label, value })

  if (f.types) {
    push(
      'types',
      'Tipo',
      f.types.map((t) => SD_TICKET_TYPE_LABEL[t]).join(', '),
    )
  }
  if (f.phaseIds) push('phaseIds', 'Fase', names(f.phaseIds, phases))
  if (f.priorityIds) {
    push(
      'priorityIds',
      'Prioridade',
      names(f.priorityIds, sdScaleOptions(config?.priorities ?? [])),
    )
  }
  if (f.severityIds) {
    push(
      'severityIds',
      'Severidade',
      names(f.severityIds, sdScaleOptions(config?.severities ?? [])),
    )
  }
  if (f.impactIds) {
    push(
      'impactIds',
      'Impacto',
      names(f.impactIds, sdScaleOptions(config?.impacts ?? [])),
    )
  }
  if (f.urgencyIds) {
    push(
      'urgencyIds',
      'Urgência',
      names(f.urgencyIds, sdScaleOptions(config?.urgencies ?? [])),
    )
  }
  if (f.departmentIds) {
    push(
      'departmentIds',
      'Departamento',
      names(f.departmentIds, sdDepartmentOptions(config?.departments ?? [])),
    )
  }
  if (f.assigneeIds) {
    push(
      'assigneeIds',
      'Responsável',
      f.assigneeIds.map((id) => assigneeName(id, agents)).join(', '),
    )
  }
  if (f.requesterId) {
    push('requesterId', 'Solicitante', assigneeName(f.requesterId, agents))
  }
  if (f.participantId) {
    push('participantId', 'Participante', assigneeName(f.participantId, agents))
  }
  for (const [key, label] of [
    ['customerId', 'Cliente'],
    ['companyId', 'Empresa'],
    ['contactId', 'Contato'],
    ['configItemId', 'Item de configuração'],
  ] as const) {
    const id = f[key]
    if (id) push(key, label, pickedLabels[id] ?? 'selecionado')
  }
  for (const [key, label] of [
    ['categoryId', 'Categoria'],
    ['subcategoryId', 'Subcategoria'],
    ['serviceId', 'Serviço'],
  ] as const) {
    const id = f[key]
    if (id) {
      push(key, label, sdCategoryName(config?.categories ?? [], id) ?? id)
    }
  }
  if (f.classificationId) {
    push(
      'classificationId',
      'Classificação',
      config?.classifications.find((c) => c.id === f.classificationId)?.name ??
        f.classificationId,
    )
  }
  if (f.channel) push('channel', 'Canal', SD_CHANNEL_LABEL[f.channel])
  if (f.tags) push('tags', 'Tags', f.tags.map((t) => `#${t}`).join(' '))
  if (f.sla) {
    push('sla', 'SLA', f.sla === 'at_risk' ? 'Em risco' : 'Violado')
  }
  if (f.riskLevel) {
    push(
      'riskLevel',
      'Risco',
      RISK_BANDS.find((b) => b.value === f.riskLevel)?.label ??
        SD_RISK_LEVEL_LABEL[f.riskLevel],
    )
  }
  if (f.createdFrom) push('createdFrom', 'Aberto desde', sdDay(f.createdFrom))
  if (f.createdTo) push('createdTo', 'Aberto até', sdDay(f.createdTo))
  if (f.dueFrom) push('dueFrom', 'Prazo desde', sdDay(f.dueFrom))
  if (f.dueTo) push('dueTo', 'Prazo até', sdDay(f.dueTo))
  if (f.includeClosed) push('includeClosed', 'Inclui', 'fechados')
  return chips
}

function sdDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? sdFormatDate(`${value}T12:00:00`)
    : value
}

/** Has the ordering left the default (newest first)? */
export function sdSortChanged(sort: SdSortField, order: 'asc' | 'desc') {
  return sort !== SD_BOARD_DEFAULTS.sort || order !== SD_BOARD_DEFAULTS.order
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className='font-medium text-muted-foreground text-xs'>{label}</span>
      {children}
    </div>
  )
}

/** A section of the filter popover — keeps the ~20 dimensions readable. */
function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className='grid gap-2'>
      <h3 className='font-medium text-muted-foreground text-xs uppercase'>
        {title}
      </h3>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{children}</div>
    </section>
  )
}

/** One-click shortcuts (mine, unassigned, SLA…) — inside the popover. */
function QuickFilters({
  filters,
  onChange,
}: {
  filters: SdBoardFilters
  onChange: (filters: SdBoardFilters) => void
}) {
  return (
    <section className='grid gap-2'>
      <h3 className='font-medium text-muted-foreground text-xs uppercase'>
        Atalhos
      </h3>
      <div className='flex flex-wrap items-center gap-1'>
        {SD_QUICK_FILTERS.map((quick) => {
          const on = sdQuickFilterActive(quick.id, filters)
          return (
            <button
              key={quick.id}
              type='button'
              aria-pressed={on}
              onClick={() => onChange(sdToggleQuickFilter(quick.id, filters))}
              className={cn(
                'h-7 rounded-full border px-2.5 font-medium text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {quick.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Fields of the "Filtrar" popover (every filter the ticket API takes). */
function AdvancedFilters({
  workspaceId,
  filters,
  onChange,
  config,
  agents,
  fixedType,
  onPick,
}: {
  workspaceId: string
  filters: SdBoardFilters
  onChange: (filters: SdBoardFilters) => void
  config?: SdConfigBootstrapDTO
  agents: SdAgentDTO[]
  fixedType: SdTicketTypeDTO | null
  onPick: (id: string, label: string) => void
}) {
  const set = <K extends keyof SdBoardFilters>(
    key: K,
    value: SdBoardFilters[K] | null,
  ) =>
    onChange(
      sdNormalizeFilters({
        ...filters,
        [key]: value ?? undefined,
      } as Record<string, unknown>),
    )

  const phaseTypes = fixedType ? [fixedType] : SD_TICKET_TYPES
  const phaseOptions: SdSelectOption[] = phaseTypes.flatMap((type) =>
    sdTypePhases(config, type).map((p) => ({
      value: p.id,
      label: fixedType ? p.name : `${p.name} · ${SD_TICKET_TYPE_LABEL[type]}`,
      color: p.color,
    })),
  )
  const people: SdSelectOption[] = [
    { value: 'me', label: 'Eu' },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ]
  const categoryType = fixedType ?? filters.types?.[0]

  return (
    <div className='grid max-h-[60vh] gap-4 overflow-y-auto p-1'>
      <QuickFilters filters={filters} onChange={onChange} />

      <Group title='Classificação'>
        {fixedType ? null : (
          <Field label='Tipo'>
            <SdMultiSelect
              label='Tipo'
              value={filters.types ?? []}
              onChange={(v) => set('types', v as SdTicketTypeDTO[])}
              options={SD_TICKET_TYPES.map((t) => ({
                value: t,
                label: SD_TICKET_TYPE_LABEL[t],
              }))}
            />
          </Field>
        )}
        <Field label='Fase'>
          <SdMultiSelect
            label='Fase'
            value={filters.phaseIds ?? []}
            onChange={(v) => set('phaseIds', v)}
            options={phaseOptions}
          />
        </Field>
        <Field label='Prioridade'>
          <SdMultiSelect
            label='Prioridade'
            value={filters.priorityIds ?? []}
            onChange={(v) => set('priorityIds', v)}
            options={sdScaleOptions(config?.priorities ?? [])}
          />
        </Field>
        <Field label='Severidade'>
          <SdMultiSelect
            label='Severidade'
            value={filters.severityIds ?? []}
            onChange={(v) => set('severityIds', v)}
            options={sdScaleOptions(config?.severities ?? [])}
          />
        </Field>
        <Field label='Impacto'>
          <SdMultiSelect
            label='Impacto'
            value={filters.impactIds ?? []}
            onChange={(v) => set('impactIds', v)}
            options={sdScaleOptions(config?.impacts ?? [])}
          />
        </Field>
        <Field label='Urgência'>
          <SdMultiSelect
            label='Urgência'
            value={filters.urgencyIds ?? []}
            onChange={(v) => set('urgencyIds', v)}
            options={sdScaleOptions(config?.urgencies ?? [])}
          />
        </Field>
        <Field label='Classificação'>
          <SdOptionSelect
            aria-label='Classificação'
            value={filters.classificationId ?? null}
            onChange={(v) => set('classificationId', v)}
            options={sdClassificationOptions(
              config?.classifications ?? [],
              'TICKET',
              categoryType,
            )}
            noneLabel='Todas'
            placeholder='Todas'
          />
        </Field>
      </Group>

      <Group title='Atribuição'>
        <Field label='Departamento'>
          <SdMultiSelect
            label='Departamento'
            value={filters.departmentIds ?? []}
            onChange={(v) => set('departmentIds', v)}
            options={sdDepartmentOptions(config?.departments ?? [])}
          />
        </Field>
        <Field label='Responsável'>
          <SdMultiSelect
            label='Responsável'
            value={filters.assigneeIds ?? []}
            onChange={(v) => set('assigneeIds', v)}
            options={[
              { value: 'me', label: 'Eu' },
              { value: 'unassigned', label: 'Não atribuído' },
              ...agents
                .filter((a) => a.isAgent)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </Field>
        <Field label='Solicitante'>
          <SdOptionSelect
            aria-label='Solicitante'
            value={filters.requesterId ?? null}
            onChange={(v) => set('requesterId', v)}
            options={people}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
        <Field label='Participante'>
          <SdOptionSelect
            aria-label='Participante'
            value={filters.participantId ?? null}
            onChange={(v) => set('participantId', v)}
            options={people}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
      </Group>

      <Group title='Catálogo'>
        <Field label='Categoria'>
          <SdOptionSelect
            aria-label='Categoria'
            value={filters.categoryId ?? null}
            onChange={(v) =>
              onChange(
                sdNormalizeFilters({
                  ...filters,
                  categoryId: v ?? undefined,
                  subcategoryId: undefined,
                  serviceId: undefined,
                } as Record<string, unknown>),
              )
            }
            options={sdCategoryOptions(config?.categories ?? [], categoryType)}
            noneLabel='Todas'
            placeholder='Todas'
          />
        </Field>
        <Field label='Subcategoria'>
          <SdOptionSelect
            aria-label='Subcategoria'
            value={filters.subcategoryId ?? null}
            disabled={!filters.categoryId}
            onChange={(v) =>
              onChange(
                sdNormalizeFilters({
                  ...filters,
                  subcategoryId: v ?? undefined,
                  serviceId: undefined,
                } as Record<string, unknown>),
              )
            }
            options={sdCategoryChildOptions(
              config?.categories ?? [],
              filters.categoryId,
              categoryType,
            )}
            noneLabel='Todas'
            placeholder='Todas'
          />
        </Field>
        <Field label='Serviço'>
          <SdOptionSelect
            aria-label='Serviço'
            value={filters.serviceId ?? null}
            disabled={!filters.subcategoryId}
            onChange={(v) => set('serviceId', v)}
            options={sdCategoryChildOptions(
              config?.categories ?? [],
              filters.subcategoryId,
              categoryType,
            )}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
      </Group>

      <Group title='Cliente e ativos'>
        <Field label='Cliente'>
          <SdCustomerPicker
            workspaceId={workspaceId}
            kind='CLIENT'
            allowCreate={false}
            placeholder='Todos'
            value={filters.customerId ?? null}
            onChange={(o) => {
              if (o) onPick(o.id, o.label)
              set('customerId', o?.id ?? null)
            }}
          />
        </Field>
        <Field label='Empresa'>
          <SdCustomerPicker
            workspaceId={workspaceId}
            kind='COMPANY'
            allowCreate={false}
            placeholder='Todas'
            value={filters.companyId ?? null}
            onChange={(o) => {
              if (o) onPick(o.id, o.label)
              set('companyId', o?.id ?? null)
            }}
          />
        </Field>
        <Field label='Contato'>
          <SdContactPicker
            workspaceId={workspaceId}
            allowCreate={false}
            placeholder='Todos'
            value={filters.contactId ?? null}
            onChange={(o) => {
              if (o) onPick(o.id, o.label)
              set('contactId', o?.id ?? null)
            }}
          />
        </Field>
        <Field label='Item de configuração'>
          <SdConfigItemPicker
            workspaceId={workspaceId}
            allowCreate={false}
            placeholder='Todos'
            value={filters.configItemId ?? null}
            onChange={(o) => {
              if (o) onPick(o.id, o.label)
              set('configItemId', o?.id ?? null)
            }}
          />
        </Field>
      </Group>

      <Group title='Atendimento'>
        <Field label='Canal'>
          <SdOptionSelect
            aria-label='Canal'
            value={filters.channel ?? null}
            onChange={(v) =>
              set('channel', (v ?? undefined) as SdBoardFilters['channel'])
            }
            options={Object.entries(SD_CHANNEL_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
        <Field label='SLA'>
          <SdOptionSelect
            aria-label='SLA'
            value={filters.sla ?? null}
            onChange={(v) =>
              set('sla', (v ?? undefined) as SdBoardFilters['sla'])
            }
            options={[
              { value: 'at_risk', label: 'Em risco' },
              { value: 'breached', label: 'Violado' },
            ]}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
        <Field label='Risco'>
          <SdOptionSelect
            aria-label='Risco'
            value={filters.riskLevel ?? null}
            onChange={(v) =>
              set('riskLevel', (v ?? undefined) as SdBoardFilters['riskLevel'])
            }
            options={RISK_BANDS}
            noneLabel='Todos'
            placeholder='Todos'
          />
        </Field>
        <Field label='Tags'>
          <div className='min-h-8 rounded-md border px-2 py-1'>
            <SdKbTagsInput
              value={filters.tags ?? []}
              onChange={(tags) => set('tags', tags)}
            />
          </div>
        </Field>
      </Group>

      <Group title='Datas'>
        <Field label='Aberto entre'>
          <div className='flex items-center gap-1'>
            <Input
              type='date'
              aria-label='Aberto desde'
              className='h-8'
              value={filters.createdFrom ?? ''}
              onChange={(e) => set('createdFrom', e.target.value || null)}
            />
            <Input
              type='date'
              aria-label='Aberto até'
              className='h-8'
              value={filters.createdTo ?? ''}
              onChange={(e) => set('createdTo', e.target.value || null)}
            />
          </div>
        </Field>
        <Field label='Prazo de resolução entre'>
          <div className='flex items-center gap-1'>
            <Input
              type='date'
              aria-label='Prazo desde'
              className='h-8'
              value={filters.dueFrom ?? ''}
              onChange={(e) => set('dueFrom', e.target.value || null)}
            />
            <Input
              type='date'
              aria-label='Prazo até'
              className='h-8'
              value={filters.dueTo ?? ''}
              onChange={(e) => set('dueTo', e.target.value || null)}
            />
          </div>
        </Field>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: o Switch é o controle */}
        <label className='flex items-center gap-2 text-sm sm:col-span-2'>
          <Switch
            checked={Boolean(filters.includeClosed)}
            onCheckedChange={(checked) =>
              set('includeClosed', checked ? true : null)
            }
          />
          Incluir resolvidos, fechados e cancelados
        </label>
      </Group>

      <Button
        variant='ghost'
        size='sm'
        className='justify-start'
        disabled={sdActiveFilterCount(filters) === 0}
        onClick={() =>
          onChange(
            filters.q
              ? ({ q: filters.q } as SdBoardFilters)
              : ({} as SdBoardFilters),
          )
        }
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
        Limpar filtros
      </Button>
    </div>
  )
}

/** Fields of the "Ordenar" popover — sorting and, in list mode, grouping. */
function SortFields({
  sort,
  order,
  onSortChange,
  group,
  onGroupChange,
}: {
  sort: SdSortField
  order: 'asc' | 'desc'
  onSortChange: (sort: SdSortField, order: 'asc' | 'desc') => void
  group?: SdListGroup
  onGroupChange?: (group: SdListGroup) => void
}) {
  return (
    <div className='grid max-h-[60vh] gap-2 overflow-y-auto'>
      <p className='font-medium text-sm'>Ordenar por</p>
      {SD_SORT_FIELDS.map((field) => {
        const active = sort === field
        return (
          <div key={field} className='flex items-center justify-between gap-2'>
            <span className='truncate text-sm'>
              {SD_SORT_FIELD_LABEL[field]}
            </span>
            <div className='flex gap-1'>
              <Button
                variant={active && order === 'asc' ? 'default' : 'outline'}
                size='xs'
                aria-label={`${SD_SORT_FIELD_LABEL[field]} crescente`}
                onClick={() => onSortChange(field, 'asc')}
              >
                Asc
              </Button>
              <Button
                variant={active && order === 'desc' ? 'default' : 'outline'}
                size='xs'
                aria-label={`${SD_SORT_FIELD_LABEL[field]} decrescente`}
                onClick={() => onSortChange(field, 'desc')}
              >
                Desc
              </Button>
            </div>
          </div>
        )
      })}
      {group && onGroupChange ? (
        <div className='grid gap-1 border-t pt-2'>
          <span className='font-medium text-muted-foreground text-xs'>
            Agrupar por
          </span>
          <SdOptionSelect
            aria-label='Agrupar por'
            allowClear={false}
            value={group}
            onChange={(next) => onGroupChange((next ?? 'phase') as SdListGroup)}
            options={Object.entries(SD_LIST_GROUP_LABEL).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </div>
      ) : null}
      <Button
        variant='ghost'
        size='sm'
        className='justify-start'
        disabled={!sdSortChanged(sort, order)}
        onClick={() =>
          onSortChange(SD_BOARD_DEFAULTS.sort, SD_BOARD_DEFAULTS.order)
        }
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
        Limpar ordenação
      </Button>
    </div>
  )
}

/** Removable tag for the active filters and ordering — the CRM design. */
function Chip({
  icon,
  label,
  value,
  removeLabel,
  onRemove,
}: {
  icon: IconSvgElement
  label: string
  value?: string
  removeLabel: string
  onRemove: () => void
}) {
  return (
    <span className='inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2 text-xs'>
      <SteelIcon
        icon={icon}
        strokeWidth={2}
        className='size-3 text-muted-foreground'
      />
      <span className='font-medium'>{label}</span>
      {value ? (
        <span className='max-w-48 truncate text-muted-foreground'>{value}</span>
      ) : null}
      <button
        type='button'
        onClick={onRemove}
        aria-label={removeLabel}
        className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} className='size-3' />
      </button>
    </span>
  )
}

/**
 * Board toolbar in the shape of the CRM grids: **three** visible controls —
 * search (`/` shortcut), `Filtrar` and `Ordenar` — with the active state as
 * removable chips below. All ~20 filter dimensions remain available, grouped
 * inside the popover; so do the shortcuts ("Meus chamados", "SLA violado"…),
 * instead of taking up the bar permanently.
 */
export function SdFilterBar({
  workspaceId,
  filters,
  onChange,
  config,
  agents,
  fixedType,
  searchRef,
  sort,
  order,
  onSortChange,
  onClearAll,
  group,
  onGroupChange,
  children,
}: {
  workspaceId: string
  filters: SdBoardFilters
  onChange: (filters: SdBoardFilters) => void
  config?: SdConfigBootstrapDTO
  agents: SdAgentDTO[]
  fixedType: SdTicketTypeDTO | null
  searchRef?: RefObject<HTMLInputElement | null>
  sort: SdSortField
  order: 'asc' | 'desc'
  onSortChange: (sort: SdSortField, order: 'asc' | 'desc') => void
  /**
   * Clears filters and ordering in **one** update. Separate `onChange` +
   * `onSortChange` calls would not do: both of the board's handlers close over
   * the same render's state, so the second `replace` would put the filters it
   * captured back into the URL and undo the first.
   */
  onClearAll: () => void
  /** List grouping — leaves the popover in the other modes. */
  group?: SdListGroup
  onGroupChange?: (group: SdListGroup) => void
  /** Extra controls on the right (mode, views, columns, new ticket). */
  children?: React.ReactNode
}) {
  const [search, setSearch] = useState(filters.q ?? '')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const debounced = useDebouncedValue(search.trim())

  // URL → campo (voltar do navegador, visão salva aplicada).
  const [lastQ, setLastQ] = useState(filters.q ?? '')
  if ((filters.q ?? '') !== lastQ) {
    setLastQ(filters.q ?? '')
    setSearch(filters.q ?? '')
  }

  // Campo → URL (com debounce).
  useEffect(() => {
    if (debounced === (filters.q ?? '')) return
    onChange(
      sdNormalizeFilters({ ...filters, q: debounced } as Record<
        string,
        unknown
      >),
    )
    // Só reage à busca digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const active = sdActiveFilterCount(filters)
  const chips = sdFilterChips(filters, { config, agents, pickedLabels: picked })
  const sorted = sdSortChanged(sort, order)

  return (
    <div className='flex shrink-0 flex-col gap-3 border-b px-4 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative mr-auto'>
          <SteelIcon
            icon={Search01Icon}
            strokeWidth={2}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground'
          />
          <Input
            ref={searchRef}
            data-tour='sd-board-search'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Buscar por título, descrição ou código…'
            aria-label='Buscar chamados'
            className='h-8 w-72 pr-8 pl-8'
          />
          <Kbd className='-translate-y-1/2 absolute top-1/2 right-2'>/</Kbd>
        </div>

        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant='outline'
                size='sm'
                data-shortcut-filters
                data-tour='sd-board-filter'
              >
                <SteelIcon icon={FilterIcon} strokeWidth={2} />
                Filtrar
                {active > 0 ? (
                  <span className='ml-0.5 rounded bg-primary px-1 text-primary-foreground text-xs tabular-nums'>
                    {active}
                  </span>
                ) : null}
              </Button>
            }
          />
          <PopoverContent align='end' className='w-[min(40rem,92vw)] p-3'>
            <AdvancedFilters
              workspaceId={workspaceId}
              filters={filters}
              onChange={onChange}
              config={config}
              agents={agents}
              fixedType={fixedType}
              onPick={(id, label) =>
                setPicked((current) => ({ ...current, [id]: label }))
              }
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger
            render={
              <Button variant='outline' size='sm' data-tour='sd-board-sort'>
                <SteelIcon icon={ArrowUpDownIcon} strokeWidth={2} />
                Ordenar
                {sorted ? (
                  <span className='ml-0.5 rounded bg-primary px-1 text-primary-foreground text-xs tabular-nums'>
                    1
                  </span>
                ) : null}
              </Button>
            }
          />
          <PopoverContent align='end' className='w-72'>
            <SortFields
              sort={sort}
              order={order}
              onSortChange={onSortChange}
              group={group}
              onGroupChange={onGroupChange}
            />
          </PopoverContent>
        </Popover>

        {children}
      </div>

      {chips.length > 0 || sorted ? (
        <div className='flex flex-wrap items-center gap-1.5'>
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              icon={FilterIcon}
              label={chip.label}
              value={chip.value}
              removeLabel={`Remover filtro ${chip.label}`}
              onRemove={() =>
                onChange(
                  sdNormalizeFilters({
                    ...filters,
                    [chip.key]: undefined,
                  } as Record<string, unknown>),
                )
              }
            />
          ))}
          {sorted ? (
            <Chip
              icon={order === 'desc' ? ArrowDown01Icon : ArrowUp01Icon}
              label={SD_SORT_FIELD_LABEL[sort]}
              removeLabel='Remover ordenação'
              onRemove={() =>
                onSortChange(SD_BOARD_DEFAULTS.sort, SD_BOARD_DEFAULTS.order)
              }
            />
          ) : null}
          <Button
            variant='ghost'
            size='xs'
            className='text-muted-foreground'
            onClick={() => {
              setSearch('')
              onClearAll()
            }}
          >
            Limpar tudo
          </Button>
        </div>
      ) : null}
    </div>
  )
}
