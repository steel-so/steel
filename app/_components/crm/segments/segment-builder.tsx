'use client'

import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { STAGE_LABELS } from '@/app/_components/crm/crm-lead-stage'
import { SimpleSelect } from '@/app/_components/crm/simple-select'
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
  CRM_SEGMENT_LEAD_STAGES,
  CRM_SEGMENT_LIST_FIELDS,
  CRM_SEGMENT_MAX_CONDITIONS,
  CRM_SEGMENT_MAX_GROUP_CONDITIONS,
  CRM_SEGMENT_MAX_GROUPS,
  type CrmSegmentCondition,
  type CrmSegmentDefinition,
  type CrmSegmentMatch,
  type CrmSegmentOptionsDTO,
  type CrmSegmentTarget,
} from '@/src/schemas/crm-segment.schema'
import {
  CONSENT_ITEMS,
  LIST_TEXT_OP_ITEMS,
  NUMBER_FIELD_LABEL,
  NUMBER_OP_ITEMS,
  presetGroups,
  TEXT_FIELD_LABEL,
  TEXT_OP_ITEMS,
} from './segment-labels'

/**
 * Visual rule builder: rows of rules joined by "todas" (E) or "qualquer
 * uma" (OU), plus groups with their own E/OU. Controlled: the parent owns
 * the draft and validates it with the same zod schema the server uses.
 */

export type Option = { value: string; label: string }

export type BuilderLookups = {
  users: Option[]
  companies: Option[]
  options: CrmSegmentOptionsDTO | undefined
}

const MATCH_ITEMS = [
  { value: 'ALL', label: 'todas' },
  { value: 'ANY', label: 'qualquer uma' },
]

function MultiPick({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: Option[]
  onChange: (next: string[]) => void
}) {
  const names = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label)
  const summary =
    values.length === 0
      ? label
      : names.length === 1
        ? names[0]
        : `${values.length} selecionados`
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
                values.length === 0
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
        <ul className='grid max-h-64 gap-0.5 overflow-y-auto'>
          {options.length === 0 ? (
            <li className='px-2 py-1.5 text-muted-foreground text-sm'>
              Nada para escolher
            </li>
          ) : null}
          {options.map((option) => {
            const checked = values.includes(option.value)
            return (
              <li key={option.value}>
                <Label className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-muted/60'>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) =>
                      onChange(
                        next === true
                          ? [...values, option.value]
                          : values.filter((v) => v !== option.value),
                      )
                    }
                  />
                  <span className='truncate'>{option.label}</span>
                </Label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function DaysInput({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (next: number) => void
  label: string
}) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <Input
        type='number'
        min={1}
        max={3650}
        inputMode='numeric'
        aria-label={label}
        className='h-8 w-20'
        value={Number.isFinite(value) && value > 0 ? value : ''}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
      <span className='text-muted-foreground text-sm'>dias</span>
    </span>
  )
}

function Fixed({ children }: { children: string }) {
  return <span className='font-medium text-sm'>{children}</span>
}

function RuleFields({
  condition,
  onChange,
  lookups,
  target,
}: {
  condition: CrmSegmentCondition
  onChange: (next: CrmSegmentCondition) => void
  lookups: BuilderLookups
  target: CrmSegmentTarget
}) {
  const small = 'w-full sm:w-52'
  switch (condition.type) {
    case 'text': {
      const listField = CRM_SEGMENT_LIST_FIELDS.includes(condition.field)
      const needsValue =
        condition.op === 'equals' || condition.op === 'contains'
      return (
        <>
          <Fixed>{TEXT_FIELD_LABEL[condition.field]}</Fixed>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={listField ? LIST_TEXT_OP_ITEMS : TEXT_OP_ITEMS}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          {needsValue ? (
            <Input
              aria-label='Valor'
              className='h-8 sm:w-56'
              placeholder='Valor'
              value={condition.value ?? ''}
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
            />
          ) : null}
        </>
      )
    }
    case 'number':
      return (
        <>
          <Fixed>{NUMBER_FIELD_LABEL[condition.field]}</Fixed>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={NUMBER_OP_ITEMS}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <Input
            type='number'
            aria-label='Valor'
            className='h-8 sm:w-40'
            value={Number.isFinite(condition.value) ? condition.value : ''}
            onChange={(event) =>
              onChange({ ...condition, value: Number(event.target.value) })
            }
          />
        </>
      )
    case 'leadStage':
      return (
        <>
          <Fixed>Etapa do lead é</Fixed>
          <MultiPick
            label='Escolha as etapas'
            values={condition.stages}
            options={CRM_SEGMENT_LEAD_STAGES.map((stage) => ({
              value: stage,
              label: STAGE_LABELS[stage],
            }))}
            onChange={(stages) =>
              onChange({
                ...condition,
                stages: stages as typeof condition.stages,
              })
            }
          />
        </>
      )
    case 'owner':
      return (
        <>
          <Fixed>Responsável</Fixed>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={[
              { value: 'in', label: 'é um de' },
              { value: 'none', label: 'não definido' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          {condition.op === 'in' ? (
            <MultiPick
              label='Escolha os responsáveis'
              values={condition.userIds}
              options={lookups.users}
              onChange={(userIds) => onChange({ ...condition, userIds })}
            />
          ) : null}
        </>
      )
    case 'company':
      return (
        <>
          <Fixed>Empresa é</Fixed>
          <MultiPick
            label='Escolha as empresas'
            values={condition.companyIds}
            options={lookups.companies}
            onChange={(companyIds) => onChange({ ...condition, companyIds })}
          />
        </>
      )
    case 'createdAt':
      return (
        <>
          <Fixed>Cadastrado</Fixed>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={[
              { value: 'withinDays', label: 'nos últimos' },
              { value: 'olderThanDays', label: 'há mais de' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <DaysInput
            label='Dias'
            value={condition.days}
            onChange={(days) => onChange({ ...condition, days })}
          />
        </>
      )
    case 'customField': {
      const fields = (lookups.options?.customFields ?? []).filter(
        (field) =>
          field.entity === (target === 'COMPANY' ? 'COMPANY' : 'PERSON'),
      )
      const field = fields.find((f) => f.id === condition.definitionId)
      const needsValue =
        condition.op === 'equals' || condition.op === 'contains'
      return (
        <>
          <SimpleSelect
            ariaLabel='Campo personalizado'
            className={small}
            value={condition.definitionId}
            placeholder='Escolha o campo'
            items={fields.map((f) => ({ value: f.id, label: f.label }))}
            onChange={(definitionId) =>
              onChange({ ...condition, definitionId, value: undefined })
            }
          />
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={
              field?.type === 'SELECT' || field?.type === 'BOOLEAN'
                ? TEXT_OP_ITEMS.filter((i) => i.value !== 'contains')
                : TEXT_OP_ITEMS
            }
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          {needsValue && field?.type === 'SELECT' ? (
            <SimpleSelect
              ariaLabel='Valor'
              className={small}
              value={typeof condition.value === 'string' ? condition.value : ''}
              placeholder='Escolha o valor'
              items={field.options.map((o) => ({ value: o, label: o }))}
              onChange={(value) => onChange({ ...condition, value })}
            />
          ) : needsValue && field?.type === 'BOOLEAN' ? (
            <SimpleSelect
              ariaLabel='Valor'
              className='w-full sm:w-32'
              value={
                condition.value === true
                  ? 'true'
                  : condition.value === false
                    ? 'false'
                    : ''
              }
              placeholder='Sim ou não'
              items={[
                { value: 'true', label: 'Sim' },
                { value: 'false', label: 'Não' },
              ]}
              onChange={(value) =>
                onChange({ ...condition, value: value === 'true' })
              }
            />
          ) : needsValue ? (
            <Input
              aria-label='Valor'
              className='h-8 sm:w-56'
              placeholder={field?.type === 'DATE' ? 'AAAA-MM-DD' : 'Valor'}
              value={
                typeof condition.value === 'string' ||
                typeof condition.value === 'number'
                  ? String(condition.value)
                  : ''
              }
              onChange={(event) =>
                onChange({
                  ...condition,
                  value:
                    field?.type === 'NUMBER' && event.target.value !== ''
                      ? Number(event.target.value)
                      : event.target.value,
                })
              }
            />
          ) : null}
        </>
      )
    }
    case 'activity':
      return (
        <>
          <Fixed>Atividade registrada</Fixed>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={[
              { value: 'withinDays', label: 'teve nos últimos' },
              { value: 'noneInDays', label: 'não teve nos últimos' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <DaysInput
            label='Dias'
            value={condition.days}
            onChange={(days) => onChange({ ...condition, days })}
          />
        </>
      )
    case 'emailEngagement':
      return (
        <>
          <SimpleSelect
            ariaLabel='Evento'
            className='w-full sm:w-36'
            value={condition.event}
            items={[
              { value: 'received', label: 'Recebeu' },
              { value: 'opened', label: 'Abriu' },
              { value: 'clicked', label: 'Clicou em' },
            ]}
            onChange={(event) =>
              onChange({ ...condition, event: event as typeof condition.event })
            }
          />
          <SimpleSelect
            ariaLabel='Quantidade'
            className='w-full sm:w-44'
            value={condition.op}
            items={[
              { value: 'any', label: 'algum e-mail' },
              { value: 'none', label: 'nenhum e-mail' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <span className='text-muted-foreground text-sm'>nos últimos</span>
          <DaysInput
            label='Dias'
            value={condition.days}
            onChange={(days) => onChange({ ...condition, days })}
          />
        </>
      )
    case 'campaign':
      return (
        <>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={[
              { value: 'in', label: 'Participou das campanhas' },
              { value: 'notIn', label: 'Não participou das campanhas' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <MultiPick
            label='Escolha as campanhas'
            values={condition.campaignIds}
            options={(lookups.options?.campaigns ?? []).map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            onChange={(campaignIds) => onChange({ ...condition, campaignIds })}
          />
        </>
      )
    case 'mailingList':
      return (
        <>
          <SimpleSelect
            ariaLabel='Condição'
            className={small}
            value={condition.op}
            items={[
              { value: 'in', label: 'Está nas listas' },
              { value: 'notIn', label: 'Não está nas listas' },
            ]}
            onChange={(op) =>
              onChange({ ...condition, op: op as typeof condition.op })
            }
          />
          <MultiPick
            label='Escolha as listas'
            values={condition.listIds}
            options={(lookups.options?.mailingLists ?? []).map((l) => ({
              value: l.id,
              label: l.name,
            }))}
            onChange={(listIds) => onChange({ ...condition, listIds })}
          />
        </>
      )
    case 'deals':
      return (
        <>
          <SimpleSelect
            ariaLabel='Condição'
            className='w-full sm:w-32'
            value={condition.has ? 'yes' : 'no'}
            items={[
              { value: 'yes', label: 'Tem' },
              { value: 'no', label: 'Não tem' },
            ]}
            onChange={(next) => onChange({ ...condition, has: next === 'yes' })}
          />
          <SimpleSelect
            ariaLabel='Tipo de negócio'
            className='w-full sm:w-52'
            value={condition.kind}
            items={[
              { value: 'won', label: 'negócio ganho (compra)' },
              { value: 'open', label: 'negócio em aberto' },
            ]}
            onChange={(kind) =>
              onChange({
                ...condition,
                kind: kind as typeof condition.kind,
                withinDays: kind === 'won' ? condition.withinDays : undefined,
              })
            }
          />
          {condition.kind === 'won' ? (
            <>
              <span className='text-muted-foreground text-sm'>
                nos últimos (opcional)
              </span>
              <DaysInput
                label='Dias'
                value={condition.withinDays ?? 0}
                onChange={(days) =>
                  onChange({ ...condition, withinDays: days || undefined })
                }
              />
            </>
          ) : null}
        </>
      )
    case 'consent':
      return (
        <SimpleSelect
          ariaLabel='Consentimento'
          className='w-full sm:w-72'
          value={condition.value}
          items={CONSENT_ITEMS}
          onChange={(value) =>
            onChange({ ...condition, value: value as typeof condition.value })
          }
        />
      )
    default:
      return null
  }
}

function AddRuleMenu({
  target,
  disabled,
  label,
  onAdd,
}: {
  target: CrmSegmentTarget
  disabled: boolean
  label: string
  onAdd: (condition: CrmSegmentCondition) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type='button' variant='outline' size='sm' disabled={disabled}>
            <SteelIcon icon={Add01Icon} className='size-3.5' />
            {label}
          </Button>
        }
      />
      <PopoverContent className='w-72 gap-1 p-2' align='start'>
        <div className='max-h-80 overflow-y-auto'>
          {presetGroups(target).map((group) => (
            <div key={group.group} className='py-1'>
              <p className='px-2 py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                {group.group}
              </p>
              {group.presets.map((preset) => (
                <button
                  key={preset.key}
                  type='button'
                  className='w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60'
                  onClick={() => onAdd(preset.make())}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ConditionList({
  conditions,
  onChange,
  lookups,
  target,
  max,
  joiner,
}: {
  conditions: CrmSegmentCondition[]
  onChange: (next: CrmSegmentCondition[]) => void
  lookups: BuilderLookups
  target: CrmSegmentTarget
  max: number
  joiner: string
}) {
  return (
    <div className='flex flex-col gap-2'>
      {conditions.map((condition, index) => (
        <div key={index} className='flex flex-col gap-2'>
          {index > 0 ? (
            <span className='text-muted-foreground text-xs uppercase tracking-wide'>
              {joiner}
            </span>
          ) : null}
          <div className='flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2'>
            <RuleFields
              condition={condition}
              lookups={lookups}
              target={target}
              onChange={(next) =>
                onChange(conditions.map((c, i) => (i === index ? next : c)))
              }
            />
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              className='ml-auto'
              aria-label='Remover regra'
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            >
              <SteelIcon icon={Cancel01Icon} className='size-4' />
            </Button>
          </div>
        </div>
      ))}
      <div>
        <AddRuleMenu
          target={target}
          disabled={conditions.length >= max}
          label='Adicionar regra'
          onAdd={(condition) => onChange([...conditions, condition])}
        />
      </div>
    </div>
  )
}

export function SegmentBuilder({
  target,
  value,
  onChange,
  lookups,
}: {
  target: CrmSegmentTarget
  value: CrmSegmentDefinition
  onChange: (next: CrmSegmentDefinition) => void
  lookups: BuilderLookups
}) {
  const topJoiner = value.match === 'ALL' ? 'e' : 'ou'
  const total =
    value.conditions.length +
    value.groups.reduce((sum, g) => sum + g.conditions.length, 0)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span>Contatos que cumprem</span>
        <SimpleSelect
          ariaLabel='Combinação das regras'
          className='w-full sm:w-40'
          value={value.match}
          items={MATCH_ITEMS}
          onChange={(match) =>
            onChange({ ...value, match: match as CrmSegmentMatch })
          }
        />
        <span>das regras abaixo</span>
      </div>

      <ConditionList
        conditions={value.conditions}
        lookups={lookups}
        target={target}
        max={CRM_SEGMENT_MAX_CONDITIONS}
        joiner={topJoiner}
        onChange={(conditions) => onChange({ ...value, conditions })}
      />

      {value.groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className='flex flex-col gap-3 rounded-xl border border-dashed bg-muted/20 p-3'
        >
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='text-muted-foreground text-xs uppercase tracking-wide'>
              {topJoiner} grupo:
            </span>
            <span>cumpre</span>
            <SimpleSelect
              ariaLabel='Combinação do grupo'
              className='w-full sm:w-40'
              value={group.match}
              items={MATCH_ITEMS}
              onChange={(match) =>
                onChange({
                  ...value,
                  groups: value.groups.map((g, i) =>
                    i === groupIndex
                      ? { ...g, match: match as CrmSegmentMatch }
                      : g,
                  ),
                })
              }
            />
            <span>das regras do grupo</span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='ml-auto'
              onClick={() =>
                onChange({
                  ...value,
                  groups: value.groups.filter((_, i) => i !== groupIndex),
                })
              }
            >
              Remover grupo
            </Button>
          </div>
          <ConditionList
            conditions={group.conditions}
            lookups={lookups}
            target={target}
            max={CRM_SEGMENT_MAX_GROUP_CONDITIONS}
            joiner={group.match === 'ALL' ? 'e' : 'ou'}
            onChange={(conditions) =>
              onChange({
                ...value,
                groups: value.groups
                  .map((g, i) => (i === groupIndex ? { ...g, conditions } : g))
                  .filter((g) => g.conditions.length > 0),
              })
            }
          />
        </div>
      ))}

      {value.groups.length < CRM_SEGMENT_MAX_GROUPS ? (
        <div>
          <AddRuleMenu
            target={target}
            disabled={false}
            label='Adicionar grupo de regras'
            onAdd={(condition) =>
              onChange({
                ...value,
                groups: [
                  ...value.groups,
                  { match: 'ANY', conditions: [condition] },
                ],
              })
            }
          />
        </div>
      ) : null}

      {total === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Sem regras, o segmento inclui todos os contatos. Adicione regras para
          refinar.
        </p>
      ) : null}
    </div>
  )
}
