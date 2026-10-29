'use client'

import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { STAGE_LABELS } from '@/app/_components/crm/crm-lead-stage'
import { SUBSCRIBER_SOURCE_LABEL } from '@/app/_components/crm/newsletters/newsletter-labels'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrmNewsletterSegmentOptions } from '@/src/hooks/use-crm-newsletter-segments'
import { CRM_NEWSLETTER_SUBSCRIBER_SOURCES } from '@/src/schemas/crm-newsletter.schema'
import {
  CRM_LEAD_STAGE_VALUES,
  CRM_NEWSLETTER_SEGMENT_MAX_CONDITIONS,
  CRM_NEWSLETTER_SEGMENT_MAX_GROUP_CONDITIONS,
  CRM_NEWSLETTER_SEGMENT_MAX_GROUPS,
  CRM_NEWSLETTER_SEGMENT_MAX_LOOKBACK,
  type CrmNewsletterSegmentOptionsDTO,
  type NewsletterSegment,
  type NewsletterSegmentCondition,
  type NewsletterSegmentConditionType,
} from '@/src/schemas/crm-newsletter-segment.schema'
import {
  CONDITION_GROUPS,
  CONDITION_LABEL,
  defaultCondition,
  segmentCompanyIds,
} from './segment-labels'

/**
 * Segment builder (slice nl2-segments): rows of conditions joined by "e",
 * plus "qualquer uma de" groups. Controlled — the parent owns the draft
 * and validates it with `NewsletterSegmentSchema`.
 */

type Scope = { workspaceId: string; newsletterId: string }

type MultiPickProps<T extends string> = {
  label: string
  placeholder: string
  values: T[]
  options: { value: T; label: string }[]
  onChange: (values: T[]) => void
  search?: { value: string; onChange: (value: string) => void }
}

function MultiPick<T extends string>({
  label,
  placeholder,
  values,
  options,
  onChange,
  search,
}: MultiPickProps<T>) {
  const selected = options.filter((option) => values.includes(option.value))
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.map((option) => option.label).join(', ')
        : `${selected.length} selecionadas`
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='min-w-0 max-w-full justify-between sm:w-56'
            aria-label={label}
          >
            <span
              className={
                selected.length === 0
                  ? 'truncate text-muted-foreground'
                  : 'truncate'
              }
            >
              {summary}
            </span>
            <SteelIcon icon={ArrowDown01Icon} className='size-3.5' />
          </Button>
        }
      />
      <PopoverContent className='w-72 gap-2 p-2' align='start'>
        {search ? (
          <div className='relative'>
            <SteelIcon
              icon={Search01Icon}
              className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
            />
            <Input
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder='Buscar pelo nome'
              className='h-8 pl-8'
              aria-label={`Buscar ${label.toLowerCase()}`}
            />
          </div>
        ) : null}
        <ul className='grid max-h-64 gap-0.5 overflow-y-auto'>
          {options.length === 0 ? (
            <li className='px-2 py-1.5 text-muted-foreground'>
              Nada encontrado
            </li>
          ) : null}
          {options.map((option) => {
            const checked = values.includes(option.value)
            return (
              <li key={option.value}>
                <Label className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 font-normal hover:bg-muted'>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) =>
                      onChange(
                        next === true
                          ? [...values, option.value]
                          : values.filter((value) => value !== option.value),
                      )
                    }
                  />
                  <span className='min-w-0 truncate'>{option.label}</span>
                </Label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className = 'sm:w-48',
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        size='sm'
        className={`w-full ${className}`}
        aria-label={label}
      >
        <SelectValue>
          {(current: string) =>
            options.find((option) => option.value === current)?.label ??
            'Escolha'
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const YES_NO = (yes: string, no: string) => [
  { value: 'yes' as const, label: yes },
  { value: 'no' as const, label: no },
]

function CompanyPick({
  scope,
  value,
  onChange,
}: {
  scope: Scope
  value: string[]
  onChange: (value: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const options = useCrmNewsletterSegmentOptions(
    scope.workspaceId,
    scope.newsletterId,
    query,
    value,
  )
  return (
    <MultiPick
      label='Empresas'
      placeholder='Escolha as empresas'
      values={value}
      options={(options.data?.companies ?? []).map((company) => ({
        value: company.id,
        label: company.name || 'Empresa sem nome',
      }))}
      onChange={onChange}
      search={{ value: query, onChange: setQuery }}
    />
  )
}

function CustomFieldControls({
  condition,
  options,
  onChange,
}: {
  condition: Extract<NewsletterSegmentCondition, { type: 'customField' }>
  options: CrmNewsletterSegmentOptionsDTO | undefined
  onChange: (condition: NewsletterSegmentCondition) => void
}) {
  const fields = options?.customFields ?? []
  const field = fields.find((f) => f.id === condition.definitionId)
  if (fields.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        Nenhum campo personalizado de pessoa no CRM.
      </p>
    )
  }
  const ops = [
    { value: 'equals' as const, label: 'é igual a' },
    ...(field?.type === 'TEXT'
      ? [{ value: 'contains' as const, label: 'contém' }]
      : []),
    { value: 'isSet' as const, label: 'está preenchido' },
    { value: 'isNotSet' as const, label: 'está vazio' },
  ]
  const needsValue = condition.op === 'equals' || condition.op === 'contains'
  return (
    <>
      <Choice
        label='Campo'
        value={condition.definitionId}
        options={fields.map((f) => ({ value: f.id, label: f.label }))}
        onChange={(definitionId) => {
          const next = fields.find((f) => f.id === definitionId)
          onChange({
            ...condition,
            definitionId,
            op: 'equals',
            value: next?.type === 'BOOLEAN' ? true : '',
          })
        }}
      />
      {field ? (
        <Choice
          label='Comparação'
          value={condition.op}
          options={ops}
          onChange={(op) => onChange({ ...condition, op })}
          className='sm:w-40'
        />
      ) : null}
      {field && needsValue ? (
        field.type === 'SELECT' ? (
          <Choice
            label='Valor'
            value={String(condition.value ?? '')}
            options={field.options.map((option) => ({
              value: option,
              label: option,
            }))}
            onChange={(value) => onChange({ ...condition, value })}
          />
        ) : field.type === 'BOOLEAN' ? (
          <Choice
            label='Valor'
            value={condition.value === false ? 'no' : 'yes'}
            options={YES_NO('Sim', 'Não')}
            onChange={(value) =>
              onChange({ ...condition, value: value === 'yes' })
            }
            className='sm:w-28'
          />
        ) : (
          <Input
            aria-label='Valor'
            className='h-8 sm:w-48'
            type={
              field.type === 'NUMBER'
                ? 'number'
                : field.type === 'DATE'
                  ? 'date'
                  : 'text'
            }
            value={String(condition.value ?? '')}
            onChange={(event) =>
              onChange({
                ...condition,
                value:
                  field.type === 'NUMBER' && event.target.value !== ''
                    ? Number(event.target.value)
                    : event.target.value,
              })
            }
          />
        )
      ) : null}
    </>
  )
}

function ConditionControls({
  condition,
  scope,
  options,
  onChange,
}: {
  condition: NewsletterSegmentCondition
  scope: Scope
  options: CrmNewsletterSegmentOptionsDTO | undefined
  onChange: (condition: NewsletterSegmentCondition) => void
}) {
  switch (condition.type) {
    case 'source':
      return (
        <MultiPick
          label='Origens'
          placeholder='Escolha as origens'
          values={condition.sources}
          options={CRM_NEWSLETTER_SUBSCRIBER_SOURCES.map((source) => ({
            value: source,
            label: SUBSCRIBER_SOURCE_LABEL[source],
          }))}
          onChange={(sources) => onChange({ ...condition, sources })}
        />
      )
    case 'subscribed':
      return (
        <>
          <Choice
            label='Quando'
            value={condition.op}
            options={[
              { value: 'before', label: 'antes de' },
              { value: 'onOrAfter', label: 'a partir de' },
            ]}
            onChange={(op) => onChange({ ...condition, op })}
            className='sm:w-36'
          />
          <Input
            type='date'
            aria-label='Data'
            className='h-8 sm:w-40'
            value={condition.date}
            onChange={(event) =>
              onChange({ ...condition, date: event.target.value })
            }
          />
        </>
      )
    case 'confirmed':
    case 'linkedPerson':
    case 'openOpportunity': {
      const labels = {
        confirmed: YES_NO('confirmou', 'não confirmou'),
        linkedPerson: YES_NO('tem', 'não tem'),
        openOpportunity: YES_NO('tem', 'não tem'),
      }[condition.type]
      return (
        <Choice
          label={CONDITION_LABEL[condition.type]}
          value={condition.value ? 'yes' : 'no'}
          options={labels}
          onChange={(value) =>
            onChange({ ...condition, value: value === 'yes' })
          }
          className='sm:w-40'
        />
      )
    }
    case 'opened':
    case 'clicked':
      return (
        <>
          <Choice
            label='Quantas'
            value={condition.op}
            options={[
              { value: 'any', label: 'em alguma das' },
              { value: 'none', label: 'em nenhuma das' },
            ]}
            onChange={(op) => onChange({ ...condition, op })}
            className='sm:w-40'
          />
          <div className='flex items-center gap-2'>
            <Input
              type='number'
              min={1}
              max={CRM_NEWSLETTER_SEGMENT_MAX_LOOKBACK}
              aria-label='Número de edições'
              className='h-8 w-20'
              value={condition.lastIssues}
              onChange={(event) =>
                onChange({
                  ...condition,
                  lastIssues: Number(event.target.value),
                })
              }
            />
            <span className='text-muted-foreground text-sm'>
              últimas edições
            </span>
          </div>
        </>
      )
    case 'neverOpened':
      return null
    case 'lastOpenedBefore':
      return (
        <Input
          type='date'
          aria-label='Data'
          className='h-8 sm:w-40'
          value={condition.date}
          onChange={(event) =>
            onChange({ ...condition, date: event.target.value })
          }
        />
      )
    case 'company':
      return (
        <CompanyPick
          scope={scope}
          value={condition.companyIds}
          onChange={(companyIds) => onChange({ ...condition, companyIds })}
        />
      )
    case 'jobTitle':
    case 'city':
      return (
        <>
          <Choice
            label='Comparação'
            value={condition.op}
            options={[
              { value: 'contains', label: 'contém' },
              { value: 'equals', label: 'é igual a' },
            ]}
            onChange={(op) => onChange({ ...condition, op })}
            className='sm:w-36'
          />
          <Input
            aria-label='Valor'
            className='h-8 sm:w-48'
            maxLength={120}
            value={condition.value}
            placeholder={
              condition.type === 'city' ? 'Ex.: Campinas' : 'Ex.: Diretor'
            }
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
          />
        </>
      )
    case 'customField':
      return (
        <CustomFieldControls
          condition={condition}
          options={options}
          onChange={onChange}
        />
      )
    case 'leadStage':
      return (
        <MultiPick
          label='Etapas'
          placeholder='Escolha as etapas'
          values={condition.stages}
          options={CRM_LEAD_STAGE_VALUES.map((stage) => ({
            value: stage,
            label: STAGE_LABELS[stage],
          }))}
          onChange={(stages) => onChange({ ...condition, stages })}
        />
      )
  }
}

function ConditionRow({
  condition,
  scope,
  options,
  onChange,
  onRemove,
}: {
  condition: NewsletterSegmentCondition
  scope: Scope
  options: CrmNewsletterSegmentOptionsDTO | undefined
  onChange: (condition: NewsletterSegmentCondition) => void
  onRemove: () => void
}) {
  return (
    <div
      className='flex min-w-0 flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:flex-wrap sm:items-center'
      data-testid='segment-condition'
    >
      <Select
        value={condition.type}
        onValueChange={(type) =>
          onChange(defaultCondition(type as NewsletterSegmentConditionType))
        }
      >
        <SelectTrigger
          size='sm'
          className='w-full sm:w-52'
          aria-label='Condição'
        >
          <SelectValue>
            {(value: string) =>
              CONDITION_LABEL[value as NewsletterSegmentConditionType]
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CONDITION_GROUPS.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.types.map((type) => (
                <SelectItem key={type} value={type}>
                  {CONDITION_LABEL[type]}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <ConditionControls
        condition={condition}
        scope={scope}
        options={options}
        onChange={onChange}
      />
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='self-end sm:ml-auto sm:self-auto'
        aria-label='Remover condição'
        onClick={onRemove}
      >
        <SteelIcon icon={Cancel01Icon} />
      </Button>
    </div>
  )
}

function Joiner({ label }: { label: string }) {
  return (
    <span className='px-1 font-medium text-muted-foreground text-xs uppercase'>
      {label}
    </span>
  )
}

export function SegmentBuilder({
  workspaceId,
  newsletterId,
  value,
  onChange,
}: {
  workspaceId: string
  newsletterId: string
  value: NewsletterSegment
  onChange: (value: NewsletterSegment) => void
}) {
  const scope = { workspaceId, newsletterId }
  const options = useCrmNewsletterSegmentOptions(
    workspaceId,
    newsletterId,
    '',
    segmentCompanyIds(value),
  )

  const setCondition = (index: number, next: NewsletterSegmentCondition) =>
    onChange({
      ...value,
      conditions: value.conditions.map((c, i) => (i === index ? next : c)),
    })
  const removeCondition = (index: number) =>
    onChange({
      ...value,
      conditions: value.conditions.filter((_, i) => i !== index),
    })
  const setGroupCondition = (
    groupIndex: number,
    index: number,
    next: NewsletterSegmentCondition | null,
  ) =>
    onChange({
      ...value,
      groups: value.groups
        .map((group, g) =>
          g === groupIndex
            ? {
                conditions: next
                  ? group.conditions.map((c, i) => (i === index ? next : c))
                  : group.conditions.filter((_, i) => i !== index),
              }
            : group,
        )
        .filter((group) => group.conditions.length > 0),
    })
  const addToGroup = (groupIndex: number) =>
    onChange({
      ...value,
      groups: value.groups.map((group, g) =>
        g === groupIndex
          ? {
              conditions: [...group.conditions, defaultCondition('opened')],
            }
          : group,
      ),
    })

  return (
    <div className='grid min-w-0 gap-2' data-testid='segment-builder'>
      {value.conditions.map((condition, index) => (
        <div key={`c-${index}`} className='grid gap-2'>
          {index > 0 ? <Joiner label='e' /> : null}
          <ConditionRow
            condition={condition}
            scope={scope}
            options={options.data}
            onChange={(next) => setCondition(index, next)}
            onRemove={() => removeCondition(index)}
          />
        </div>
      ))}
      {value.groups.map((group, groupIndex) => (
        <div key={`g-${groupIndex}`} className='grid gap-2'>
          {value.conditions.length > 0 || groupIndex > 0 ? (
            <Joiner label='e' />
          ) : null}
          <fieldset className='grid min-w-0 gap-2 rounded-lg border border-dashed p-2'>
            <legend className='px-1 text-muted-foreground text-xs'>
              Qualquer uma destas
            </legend>
            {group.conditions.map((condition, index) => (
              <div key={`g-${groupIndex}-${index}`} className='grid gap-2'>
                {index > 0 ? <Joiner label='ou' /> : null}
                <ConditionRow
                  condition={condition}
                  scope={scope}
                  options={options.data}
                  onChange={(next) =>
                    setGroupCondition(groupIndex, index, next)
                  }
                  onRemove={() => setGroupCondition(groupIndex, index, null)}
                />
              </div>
            ))}
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='justify-self-start'
              disabled={
                group.conditions.length >=
                CRM_NEWSLETTER_SEGMENT_MAX_GROUP_CONDITIONS
              }
              onClick={() => addToGroup(groupIndex)}
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar opção
            </Button>
          </fieldset>
        </div>
      ))}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={
            value.conditions.length >= CRM_NEWSLETTER_SEGMENT_MAX_CONDITIONS
          }
          onClick={() =>
            onChange({
              ...value,
              conditions: [...value.conditions, defaultCondition('opened')],
            })
          }
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Adicionar condição
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={value.groups.length >= CRM_NEWSLETTER_SEGMENT_MAX_GROUPS}
          onClick={() =>
            onChange({
              ...value,
              groups: [
                ...value.groups,
                {
                  conditions: [
                    defaultCondition('opened'),
                    defaultCondition('clicked'),
                  ],
                },
              ],
            })
          }
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Adicionar grupo "qualquer uma"
        </Button>
      </div>
    </div>
  )
}
