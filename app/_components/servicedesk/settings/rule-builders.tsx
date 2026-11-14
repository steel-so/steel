'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { CrossEngineSendFields } from '@/app/_components/whatsapp/cross-engine-send-fields'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSdAgents } from '@/src/hooks/use-sd-config'
import {
  type SD_CONDITION_OPERATORS,
  SD_WHATSAPP_VARIABLES,
  type SdAutomationAction,
  SdAutomationActionsSchema,
  type SdCondition,
  SdConditionsSchema,
  type SdEscalationActions,
  SdEscalationActionsSchema,
  type SdWhatsappVariable,
} from '@/src/schemas/sd-rule.schema'
import { SD_CHANGE_TYPES, SD_RISK_LEVELS } from '@/src/schemas/sd-ticket.schema'
import type {
  SdCategoryTreeDTO,
  SdConfigBootstrapDTO,
  SdDepartmentTreeDTO,
} from '@/types/sd-config'
import { SD_CHANGE_TYPE_LABEL, SD_RISK_LABEL } from '../ticket/sd-ticket-meta'
import {
  FieldBlock,
  SD_PHASE_CATEGORY_OPTIONS,
  SD_TICKET_TYPE_LABEL,
  SD_TICKET_TYPE_OPTIONS,
  SimpleSelect,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

// ── Validação (Zod do contrato compartilhado) ──────────────────────────────

function firstIssue(
  result:
    | { success: true }
    | {
        success: false
        error: { issues: { message: string; path: PropertyKey[] }[] }
      },
  prefix: string,
): string | null {
  if (result.success) return null
  const issue = result.error.issues[0]
  const index = typeof issue.path[0] === 'number' ? ` ${issue.path[0] + 1}` : ''
  return `${prefix}${index}: ${issue.message}`
}

/** Primeiro problema das condições (ou `null` se válidas). */
export function validateSdConditions(value: SdCondition[]): string | null {
  return firstIssue(SdConditionsSchema.safeParse(value), 'Condição')
}

/** Primeiro problema das ações de automação (ou `null`). */
export function validateSdAutomationActions(
  value: SdAutomationAction[],
): string | null {
  return firstIssue(SdAutomationActionsSchema.safeParse(value), 'Ação')
}

/** Primeiro problema das ações de escalonamento (ou `null`). */
export function validateSdEscalationActions(
  value: SdEscalationActions,
): string | null {
  const result = SdEscalationActionsSchema.safeParse(value)
  if (result.success) return null
  return result.error.issues[0]?.message ?? 'Ações inválidas'
}

// ── Metadados dos campos ───────────────────────────────────────────────────

type FieldKind = 'enum' | 'ref' | 'number' | 'text' | 'tags' | 'id'
type Option = { value: string; label: string }

interface FieldMeta {
  field: string
  label: string
  group: string
  kind: FieldKind
}

const FIELDS: FieldMeta[] = [
  { field: 'type', label: 'Tipo', group: 'Chamado', kind: 'enum' },
  { field: 'channel', label: 'Canal', group: 'Chamado', kind: 'enum' },
  { field: 'title', label: 'Título', group: 'Chamado', kind: 'text' },
  { field: 'description', label: 'Descrição', group: 'Chamado', kind: 'text' },
  { field: 'tags', label: 'Tags', group: 'Chamado', kind: 'tags' },
  { field: 'phaseId', label: 'Fase', group: 'Fluxo', kind: 'ref' },
  {
    field: 'phaseCategory',
    label: 'Semântica da fase',
    group: 'Fluxo',
    kind: 'enum',
  },
  {
    field: 'escalationLevel',
    label: 'Nível de escalonamento',
    group: 'Fluxo',
    kind: 'number',
  },
  {
    field: 'priorityId',
    label: 'Prioridade',
    group: 'Prioridade',
    kind: 'ref',
  },
  {
    field: 'priorityLevel',
    label: 'Peso da prioridade',
    group: 'Prioridade',
    kind: 'number',
  },
  { field: 'impactId', label: 'Impacto', group: 'Prioridade', kind: 'ref' },
  { field: 'urgencyId', label: 'Urgência', group: 'Prioridade', kind: 'ref' },
  {
    field: 'severityId',
    label: 'Severidade',
    group: 'Prioridade',
    kind: 'ref',
  },
  { field: 'categoryId', label: 'Categoria', group: 'Catálogo', kind: 'ref' },
  {
    field: 'subcategoryId',
    label: 'Subcategoria',
    group: 'Catálogo',
    kind: 'ref',
  },
  { field: 'serviceId', label: 'Serviço', group: 'Catálogo', kind: 'ref' },
  {
    field: 'classificationId',
    label: 'Classificação',
    group: 'Catálogo',
    kind: 'ref',
  },
  {
    field: 'departmentId',
    label: 'Departamento',
    group: 'Atendimento',
    kind: 'ref',
  },
  {
    field: 'assigneeId',
    label: 'Responsável',
    group: 'Atendimento',
    kind: 'ref',
  },
  {
    field: 'requesterId',
    label: 'Solicitante',
    group: 'Atendimento',
    kind: 'ref',
  },
  {
    field: 'customerId',
    label: 'Cliente (id)',
    group: 'Cadastros',
    kind: 'id',
  },
  { field: 'companyId', label: 'Empresa (id)', group: 'Cadastros', kind: 'id' },
  { field: 'contactId', label: 'Contato (id)', group: 'Cadastros', kind: 'id' },
  {
    field: 'configItemId',
    label: 'Item de configuração (id)',
    group: 'Cadastros',
    kind: 'id',
  },
  {
    field: 'changeType',
    label: 'Tipo de mudança',
    group: 'Mudança',
    kind: 'enum',
  },
  {
    field: 'changeRisk',
    label: 'Risco da mudança',
    group: 'Mudança',
    kind: 'enum',
  },
]

const OPERATOR_LABEL: Record<(typeof SD_CONDITION_OPERATORS)[number], string> =
  {
    equals: 'é igual a',
    not_equals: 'é diferente de',
    in: 'é um de',
    not_in: 'não é nenhum de',
    contains: 'contém',
    is_empty: 'está vazio',
    is_not_empty: 'está preenchido',
    gt: 'é maior que',
    lt: 'é menor que',
  }

const OPERATORS_BY_KIND: Record<FieldKind, SdCondition['operator'][]> = {
  enum: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  ref: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  tags: ['contains', 'is_empty', 'is_not_empty'],
  id: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
}

const CHANNEL_OPTIONS: Option[] = [
  { value: 'AGENT', label: 'Agente' },
  { value: 'PORTAL', label: 'Portal' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'PHONE', label: 'Telefone' },
  { value: 'AI', label: 'IA' },
  { value: 'API', label: 'API' },
]

function flattenDepartments(tree: SdDepartmentTreeDTO[] = []): Option[] {
  return tree.flatMap((root) => [
    { value: root.id, label: root.name },
    ...root.children.map((c) => ({
      value: c.id,
      label: `${root.name} › ${c.name}`,
    })),
  ])
}

function flattenCategories(
  tree: SdCategoryTreeDTO[] | undefined,
  level: SdCategoryTreeDTO['level'],
  prefix = '',
): Option[] {
  return (tree ?? []).flatMap((node) => {
    const label = prefix ? `${prefix} › ${node.name}` : node.name
    return [
      ...(node.level === level ? [{ value: node.id, label }] : []),
      ...flattenCategories(node.children, level, label),
    ]
  })
}

/** Opções de um campo (enums, lookups do bootstrap, agentes). */
function useFieldOptions() {
  const { workspaceId, config } = useSdSettingsContext()
  const agents = useSdAgents(workspaceId, { includeRequesters: true })
  const users: Option[] = (agents.data ?? []).map((a) => ({
    value: a.id,
    label: a.name,
  }))
  const departments = flattenDepartments(config?.departments)

  return {
    users,
    departments,
    templates: (config?.templates ?? []).map((t) => ({
      value: t.id,
      label: `${t.name} (${SD_TICKET_TYPE_LABEL[t.ticketType]})`,
    })),
    optionsFor(field: string): Option[] {
      const scale = (list: SdConfigBootstrapDTO['priorities'] | undefined) =>
        (list ?? []).map((i) => ({ value: i.id, label: i.name }))
      switch (field) {
        case 'type':
          return SD_TICKET_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))
        case 'channel':
          return CHANNEL_OPTIONS
        case 'phaseCategory':
          return SD_PHASE_CATEGORY_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))
        case 'phaseId':
          return (config?.phases ?? []).flatMap((flow) =>
            flow.phases.map((p) => ({
              value: p.id,
              label: `${SD_TICKET_TYPE_LABEL[flow.ticketType]} › ${p.name}`,
            })),
          )
        case 'priorityId':
          return scale(config?.priorities)
        case 'impactId':
          return scale(config?.impacts)
        case 'urgencyId':
          return scale(config?.urgencies)
        case 'severityId':
          return scale(config?.severities)
        case 'categoryId':
          return flattenCategories(config?.categories, 'CATEGORY')
        case 'subcategoryId':
          return flattenCategories(config?.categories, 'SUBCATEGORY')
        case 'serviceId':
          return flattenCategories(config?.categories, 'SERVICE')
        case 'classificationId':
          return (config?.classifications ?? [])
            .filter((c) => c.kind === 'TICKET')
            .map((c) => ({ value: c.id, label: c.name }))
        case 'changeType':
          return SD_CHANGE_TYPES.map((value) => ({
            value,
            label: SD_CHANGE_TYPE_LABEL[value],
          }))
        case 'changeRisk':
          return SD_RISK_LEVELS.map((value) => ({
            value,
            label: SD_RISK_LABEL[value],
          }))
        case 'departmentId':
          return departments
        case 'assigneeId':
        case 'requesterId':
          return users
        default: {
          const key = field.startsWith('customFields.') ? field.slice(13) : null
          const def = config?.customFields.find(
            (f) => f.entity === 'TICKET' && f.key === key,
          )
          if (def?.type === 'CHECKBOX') {
            return [
              { value: 'true', label: 'Marcado' },
              { value: 'false', label: 'Desmarcado' },
            ]
          }
          return (def?.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
          }))
        }
      }
    },
  }
}

function useFields(): FieldMeta[] {
  const { config } = useSdSettingsContext()
  const custom: FieldMeta[] = (config?.customFields ?? [])
    .filter((f) => f.entity === 'TICKET')
    .map((f) => ({
      field: `customFields.${f.key}`,
      label: f.label,
      group: 'Campos customizados',
      kind:
        f.type === 'SELECT' ||
        f.type === 'MULTI_SELECT' ||
        f.type === 'CHECKBOX'
          ? 'enum'
          : f.type === 'NUMBER' || f.type === 'CURRENCY'
            ? 'number'
            : f.type === 'USER'
              ? 'id'
              : 'text',
    }))
  return [...FIELDS, ...custom]
}

// ── Peças de UI ────────────────────────────────────────────────────────────

function GroupedSelect({
  value,
  onChange,
  fields,
  disabled,
  placeholder = 'Campo',
}: {
  value: string | null
  onChange: (value: string) => void
  fields: FieldMeta[]
  disabled?: boolean
  placeholder?: string
}) {
  const groups = [...new Set(fields.map((f) => f.group))]
  return (
    <Select
      items={fields.map((f) => ({ value: f.field, label: f.label }))}
      value={value}
      onValueChange={(next) => next && onChange(next as string)}
      disabled={disabled}
    >
      <SelectTrigger className='w-full min-w-44'>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group}>
            <SelectLabel>{group}</SelectLabel>
            {fields
              .filter((f) => f.group === group)
              .map((f) => (
                <SelectItem key={f.field} value={f.field}>
                  {f.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Chips de múltipla escolha. */
export function MultiChips({
  options,
  value,
  onChange,
  disabled,
  empty = 'Nenhuma opção disponível',
}: {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  empty?: string
}) {
  if (options.length === 0) {
    return <span className='text-xs text-muted-foreground'>{empty}</span>
  }
  return (
    <div className='flex flex-wrap gap-1.5'>
      {options.map((option) => {
        const active = value.includes(option.value)
        return (
          <button
            key={option.value}
            type='button'
            disabled={disabled}
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value],
              )
            }
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ValueEditor({
  meta,
  operator,
  value,
  onChange,
  disabled,
  options,
}: {
  meta: FieldMeta | undefined
  operator: SdCondition['operator']
  value: SdCondition['value']
  onChange: (value: SdCondition['value']) => void
  disabled?: boolean
  options: Option[]
}) {
  if (operator === 'is_empty' || operator === 'is_not_empty') return null
  const kind = meta?.kind ?? 'text'
  const isList = operator === 'in' || operator === 'not_in'

  if ((kind === 'enum' || kind === 'ref') && options.length > 0) {
    if (isList) {
      const list = Array.isArray(value) ? value.map(String) : []
      return (
        <MultiChips
          options={options}
          value={list}
          onChange={onChange}
          disabled={disabled}
        />
      )
    }
    const current =
      typeof value === 'boolean'
        ? String(value)
        : value == null
          ? null
          : String(value)
    return (
      <SimpleSelect
        value={current}
        options={options}
        onChange={(next) => {
          if (next === 'true' || next === 'false') {
            const isCheckbox =
              options.length === 2 && options[0].value === 'true'
            onChange(isCheckbox ? next === 'true' : next)
          } else onChange(next)
        }}
        placeholder='Valor'
        disabled={disabled}
      />
    )
  }

  if (kind === 'number') {
    return (
      <Input
        type='number'
        value={typeof value === 'number' ? value : ''}
        disabled={disabled}
        placeholder='Valor'
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
      />
    )
  }

  if (isList) {
    return (
      <Input
        value={Array.isArray(value) ? value.join(', ') : ''}
        disabled={disabled}
        placeholder='Valores separados por vírgula'
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
      />
    )
  }

  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      placeholder='Valor'
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// ── Construtor de condições ────────────────────────────────────────────────

/** Editor controlado de `SdCondition[]` (todas precisam casar — AND). */
export function SdConditionBuilder({
  value,
  onChange,
  disabled,
}: {
  value: SdCondition[]
  onChange: (value: SdCondition[]) => void
  disabled?: boolean
}) {
  const fields = useFields()
  const { optionsFor } = useFieldOptions()

  function update(index: number, patch: Partial<SdCondition>) {
    onChange(
      value.map((c, i) =>
        i === index ? ({ ...c, ...patch } as SdCondition) : c,
      ),
    )
  }

  function changeField(index: number, field: string) {
    const meta = fields.find((f) => f.field === field)
    const operator = OPERATORS_BY_KIND[meta?.kind ?? 'text'][0]
    update(index, {
      field: field as SdCondition['field'],
      operator,
      value: undefined,
    })
  }

  function changeOperator(index: number, operator: SdCondition['operator']) {
    const current = value[index]
    const toList = operator === 'in' || operator === 'not_in'
    const wasList = Array.isArray(current.value)
    let next: SdCondition['value'] = current.value
    if (operator === 'is_empty' || operator === 'is_not_empty') next = undefined
    else if (toList && !wasList)
      next = current.value == null ? [] : [String(current.value)]
    else if (!toList && wasList)
      next = (current.value as (string | number)[])[0] ?? undefined
    update(index, { operator, value: next })
  }

  return (
    <div className='flex flex-col gap-2'>
      {value.length === 0 ? (
        <div className='rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground'>
          Sempre (sem condições) — vale para todos os chamados.
        </div>
      ) : null}
      {value.map((condition, index) => {
        const meta = fields.find((f) => f.field === condition.field)
        const operators = OPERATORS_BY_KIND[meta?.kind ?? 'text']
        return (
          <div key={index} className='flex flex-col gap-1.5'>
            {index > 0 ? (
              <span className='pl-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                E
              </span>
            ) : null}
            <div className='flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5 md:flex-row md:items-start'>
              <div className='md:w-56'>
                <GroupedSelect
                  value={condition.field}
                  fields={fields}
                  onChange={(field) => changeField(index, field)}
                  disabled={disabled}
                />
              </div>
              <div className='md:w-44'>
                <SimpleSelect
                  value={condition.operator}
                  options={operators.map((op) => ({
                    value: op,
                    label: OPERATOR_LABEL[op],
                  }))}
                  onChange={(op) => op && changeOperator(index, op)}
                  disabled={disabled}
                />
              </div>
              <div className='min-w-0 flex-1'>
                <ValueEditor
                  meta={meta}
                  operator={condition.operator}
                  value={condition.value}
                  options={optionsFor(condition.field)}
                  onChange={(next) => update(index, { value: next })}
                  disabled={disabled}
                />
              </div>
              {!disabled ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Remover condição'
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                </Button>
              ) : null}
            </div>
          </div>
        )
      })}
      {!disabled ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='self-start'
          onClick={() =>
            onChange([
              ...value,
              { field: 'type', operator: 'equals', value: 'INCIDENT' },
            ])
          }
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Adicionar condição
        </Button>
      ) : null}
    </div>
  )
}

/** Resumo legível das condições (listas). */
export function summarizeSdConditions(conditions: SdCondition[]): string {
  if (conditions.length === 0) return 'Sempre'
  const labels = new Map(FIELDS.map((f) => [f.field, f.label]))
  return conditions
    .map((c) => {
      const field = labels.get(c.field) ?? c.field.replace('customFields.', '')
      const op = OPERATOR_LABEL[c.operator]
      if (c.operator === 'is_empty' || c.operator === 'is_not_empty')
        return `${field} ${op}`
      const raw = Array.isArray(c.value) ? c.value.join(', ') : String(c.value)
      const value =
        c.field === 'type' && typeof c.value === 'string'
          ? (SD_TICKET_TYPE_LABEL[
              c.value as keyof typeof SD_TICKET_TYPE_LABEL
            ] ?? raw)
          : raw.length > 24
            ? `${raw.slice(0, 24)}…`
            : raw
      return `${field} ${op} ${value}`
    })
    .join(' e ')
}

// ── Construtor de ações de automação ───────────────────────────────────────

type ActionType = SdAutomationAction['type']

const SD_WHATSAPP_VARIABLE_CHOICES = [
  { value: 'code', label: 'Código do chamado' },
  { value: 'title', label: 'Título do chamado' },
  { value: 'requester', label: 'Nome do solicitante' },
  { value: 'phase', label: 'Fase atual' },
]

export const SD_AUTOMATION_ACTION_META: Record<
  ActionType,
  { label: string; description: string }
> = {
  set_field: {
    label: 'Alterar campo',
    description: 'Define um valor em um campo do chamado.',
  },
  assign_department: {
    label: 'Atribuir departamento',
    description: 'Move o chamado para um time.',
  },
  assign_user: {
    label: 'Atribuir responsável',
    description: 'Define o agente responsável.',
  },
  round_robin: {
    label: 'Distribuir (round-robin)',
    description: 'Atribui ao próximo agente do time.',
  },
  add_participant: {
    label: 'Adicionar participante',
    description: 'Inclui alguém para acompanhar.',
  },
  add_tag: {
    label: 'Adicionar tag',
    description: 'Marca o chamado com uma tag.',
  },
  notify: {
    label: 'Notificar',
    description: 'Avisa pessoas no app e/ou por e-mail.',
  },
  post_message: {
    label: 'Publicar mensagem',
    description: 'Posta no histórico (pública ou interna).',
  },
  create_task: {
    label: 'Criar tarefa',
    description: 'Adiciona uma tarefa ao chamado.',
  },
  apply_template: {
    label: 'Aplicar modelo',
    description: 'Aplica valores e checklist de um modelo.',
  },
  send_whatsapp_template: {
    label: 'Enviar WhatsApp',
    description:
      'Envia um modelo aprovado ao contato do chamado (respeita quem não quer receber).',
  },
  create_crm_task: {
    label: 'Criar tarefa no CRM',
    description: 'Abre uma tarefa de acompanhamento no CRM.',
  },
  create_crm_lead: {
    label: 'Criar lead no CRM',
    description: 'Cadastra o contato do chamado como lead, sem duplicar.',
  },
  escalate: {
    label: 'Escalonar',
    description: 'Escalonamento funcional ou hierárquico.',
  },
}

function defaultAction(type: ActionType): SdAutomationAction {
  switch (type) {
    case 'set_field':
      return { type, params: { field: 'priorityId', value: null } }
    case 'assign_department':
      return { type, params: { departmentId: '' } }
    case 'assign_user':
      return { type, params: { userId: '' } }
    case 'round_robin':
      return { type, params: {} }
    case 'add_participant':
      return { type, params: { userId: '' } }
    case 'add_tag':
      return { type, params: { tag: '' } }
    case 'notify':
      return {
        type,
        params: {
          userIds: [],
          assignee: true,
          requester: false,
          departmentLeads: false,
          email: false,
          title: '',
          message: '',
        },
      }
    case 'post_message':
      return { type, params: { body: '', visibility: 'INTERNAL' } }
    case 'create_task':
      return { type, params: { title: '' } }
    case 'apply_template':
      return { type, params: { templateId: '' } }
    case 'send_whatsapp_template':
      return { type, params: { connectionId: '', variables: [] } }
    case 'create_crm_task':
      return { type, params: { title: '' } }
    case 'create_crm_lead':
      return { type, params: { origin: 'ServiceDesk' } }
    case 'escalate':
      return { type, params: { kind: 'HIERARCHICAL', reason: '' } }
  }
}

function ActionParams({
  action,
  onChange,
  disabled,
}: {
  action: SdAutomationAction
  onChange: (action: SdAutomationAction) => void
  disabled?: boolean
}) {
  const { users, departments, templates, optionsFor } = useFieldOptions()
  const { workspaceId } = useSdSettingsContext()
  const fields = useFields().filter((f) => f.kind !== 'tags')

  switch (action.type) {
    case 'set_field': {
      const meta = fields.find((f) => f.field === action.params.field)
      return (
        <div className='grid gap-2 md:grid-cols-2'>
          <FieldBlock label='Campo'>
            <GroupedSelect
              value={action.params.field}
              fields={fields}
              disabled={disabled}
              onChange={(field) =>
                onChange({
                  ...action,
                  params: {
                    field: field as typeof action.params.field,
                    value: null,
                  },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Novo valor'>
            <ValueEditor
              meta={meta}
              operator='equals'
              value={action.params.value}
              options={optionsFor(action.params.field)}
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  ...action,
                  params: { ...action.params, value: value ?? null },
                })
              }
            />
          </FieldBlock>
        </div>
      )
    }
    case 'assign_department':
    case 'round_robin': {
      const current =
        action.type === 'assign_department'
          ? action.params.departmentId
          : (action.params.departmentId ?? null)
      return (
        <FieldBlock
          label='Departamento'
          hint={
            action.type === 'round_robin'
              ? 'Vazio = departamento atual do chamado.'
              : undefined
          }
        >
          <SimpleSelect
            value={current || null}
            options={departments}
            allowEmpty={action.type === 'round_robin'}
            emptyLabel='Departamento do chamado'
            disabled={disabled}
            onChange={(departmentId) =>
              onChange(
                action.type === 'assign_department'
                  ? { ...action, params: { departmentId: departmentId ?? '' } }
                  : { ...action, params: departmentId ? { departmentId } : {} },
              )
            }
          />
        </FieldBlock>
      )
    }
    case 'assign_user':
    case 'add_participant':
      return (
        <FieldBlock label='Usuário'>
          <SimpleSelect
            value={action.params.userId || null}
            options={users}
            disabled={disabled}
            onChange={(userId) =>
              onChange({ ...action, params: { userId: userId ?? '' } })
            }
          />
        </FieldBlock>
      )
    case 'add_tag':
      return (
        <FieldBlock label='Tag'>
          <Input
            value={action.params.tag}
            maxLength={50}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...action, params: { tag: e.target.value } })
            }
          />
        </FieldBlock>
      )
    case 'notify': {
      const p = action.params
      const set = (patch: Partial<typeof p>) =>
        onChange({ ...action, params: { ...p, ...patch } })
      return (
        <div className='flex flex-col gap-2'>
          <div className='grid gap-x-4 sm:grid-cols-2'>
            <ToggleRow
              label='Responsável'
              checked={p.assignee}
              disabled={disabled}
              onCheckedChange={(v) => set({ assignee: v })}
            />
            <ToggleRow
              label='Solicitante'
              checked={p.requester}
              disabled={disabled}
              onCheckedChange={(v) => set({ requester: v })}
            />
            <ToggleRow
              label='Líderes do departamento'
              checked={p.departmentLeads}
              disabled={disabled}
              onCheckedChange={(v) => set({ departmentLeads: v })}
            />
            <ToggleRow
              label='Também por e-mail'
              checked={p.email}
              disabled={disabled}
              onCheckedChange={(v) => set({ email: v })}
            />
          </div>
          <FieldBlock label='Outras pessoas'>
            <MultiChips
              options={users}
              value={p.userIds}
              disabled={disabled}
              onChange={(userIds) => set({ userIds })}
            />
          </FieldBlock>
          <FieldBlock label='Título'>
            <Input
              value={p.title}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => set({ title: e.target.value })}
            />
          </FieldBlock>
          <FieldBlock label='Mensagem'>
            <Textarea
              value={p.message}
              rows={2}
              disabled={disabled}
              onChange={(e) => set({ message: e.target.value })}
            />
          </FieldBlock>
        </div>
      )
    }
    case 'post_message':
      return (
        <div className='flex flex-col gap-2'>
          <FieldBlock label='Visibilidade'>
            <SimpleSelect
              value={action.params.visibility}
              options={[
                { value: 'INTERNAL', label: 'Nota interna' },
                { value: 'PUBLIC', label: 'Pública (solicitante vê)' },
              ]}
              disabled={disabled}
              onChange={(visibility) =>
                onChange({
                  ...action,
                  params: {
                    ...action.params,
                    visibility: visibility ?? 'INTERNAL',
                  },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Texto'>
            <Textarea
              value={action.params.body}
              rows={3}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...action,
                  params: { ...action.params, body: e.target.value },
                })
              }
            />
          </FieldBlock>
        </div>
      )
    case 'create_task':
      return (
        <div className='grid gap-2 md:grid-cols-2'>
          <FieldBlock label='Título' className='md:col-span-2'>
            <Input
              value={action.params.title}
              maxLength={200}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...action,
                  params: { ...action.params, title: e.target.value },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Responsável'>
            <SimpleSelect
              value={action.params.assigneeId ?? null}
              options={users}
              allowEmpty
              emptyLabel='Ninguém'
              disabled={disabled}
              onChange={(assigneeId) =>
                onChange({
                  ...action,
                  params: {
                    ...action.params,
                    assigneeId: assigneeId ?? undefined,
                  },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Prazo (minutos após a regra)'>
            <Input
              type='number'
              min={1}
              value={action.params.dueInMinutes ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...action,
                  params: {
                    ...action.params,
                    dueInMinutes:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  },
                })
              }
            />
          </FieldBlock>
        </div>
      )
    case 'send_whatsapp_template':
      return (
        <CrossEngineSendFields
          workspaceId={workspaceId}
          variableChoices={SD_WHATSAPP_VARIABLE_CHOICES}
          value={{
            connectionId: action.params.connectionId,
            templateId: action.params.templateId,
            variables: action.params.variables,
            text: action.params.text,
          }}
          onChange={(next) =>
            onChange({
              ...action,
              params: {
                ...next,
                variables: next.variables.filter((v): v is SdWhatsappVariable =>
                  (SD_WHATSAPP_VARIABLES as readonly string[]).includes(v),
                ),
              },
            })
          }
        />
      )
    case 'create_crm_task':
      return (
        <div className='grid gap-2 md:grid-cols-2'>
          <FieldBlock
            label='Título'
            className='md:col-span-2'
            hint='Use {{code}}, {{title}}, {{requester}} e {{phase}}.'
          >
            <Input
              value={action.params.title}
              maxLength={200}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...action,
                  params: { ...action.params, title: e.target.value },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Responsável'>
            <SimpleSelect
              value={action.params.assigneeId ?? null}
              options={users}
              allowEmpty
              emptyLabel='Responsável do chamado'
              disabled={disabled}
              onChange={(assigneeId) =>
                onChange({
                  ...action,
                  params: {
                    ...action.params,
                    assigneeId: assigneeId ?? undefined,
                  },
                })
              }
            />
          </FieldBlock>
          <FieldBlock label='Prazo (minutos após a regra)'>
            <Input
              type='number'
              min={1}
              value={action.params.dueInMinutes ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...action,
                  params: {
                    ...action.params,
                    dueInMinutes:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  },
                })
              }
            />
          </FieldBlock>
        </div>
      )
    case 'create_crm_lead':
      return (
        <FieldBlock
          label='Origem do lead'
          hint='Se já existir um lead aberto com o mesmo telefone ou e-mail, ele é reaproveitado.'
        >
          <Input
            value={action.params.origin}
            maxLength={100}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...action,
                params: { origin: e.target.value || 'ServiceDesk' },
              })
            }
          />
        </FieldBlock>
      )
    case 'apply_template':
      return (
        <FieldBlock label='Modelo'>
          <SimpleSelect
            value={action.params.templateId || null}
            options={templates}
            disabled={disabled}
            onChange={(templateId) =>
              onChange({ ...action, params: { templateId: templateId ?? '' } })
            }
          />
        </FieldBlock>
      )
    case 'escalate': {
      const p = action.params
      const set = (patch: Partial<typeof p>) =>
        onChange({ ...action, params: { ...p, ...patch } })
      return (
        <div className='grid gap-2 md:grid-cols-2'>
          <FieldBlock label='Tipo'>
            <SimpleSelect
              value={p.kind}
              options={[
                {
                  value: 'HIERARCHICAL',
                  label: 'Hierárquico (líder / nível +1)',
                },
                { value: 'FUNCTIONAL', label: 'Funcional (outro time)' },
              ]}
              disabled={disabled}
              onChange={(kind) => set({ kind: kind ?? 'HIERARCHICAL' })}
            />
          </FieldBlock>
          <FieldBlock label='Para o departamento'>
            <SimpleSelect
              value={p.toDepartmentId ?? null}
              options={departments}
              allowEmpty
              disabled={disabled}
              onChange={(id) => set({ toDepartmentId: id ?? undefined })}
            />
          </FieldBlock>
          <FieldBlock label='Para o usuário'>
            <SimpleSelect
              value={p.toUserId ?? null}
              options={users}
              allowEmpty
              disabled={disabled}
              onChange={(id) => set({ toUserId: id ?? undefined })}
            />
          </FieldBlock>
          <FieldBlock label='Motivo'>
            <Input
              value={p.reason}
              maxLength={500}
              disabled={disabled}
              onChange={(e) => set({ reason: e.target.value })}
            />
          </FieldBlock>
        </div>
      )
    }
  }
}

/** Editor controlado da lista de ações de uma automação (em ordem). */
export function SdAutomationActionsBuilder({
  value,
  onChange,
  disabled,
}: {
  value: SdAutomationAction[]
  onChange: (value: SdAutomationAction[]) => void
  disabled?: boolean
}) {
  function move(index: number, delta: number) {
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className='flex flex-col gap-2'>
      {value.length === 0 ? (
        <div className='rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground'>
          Nenhuma ação — adicione ao menos uma.
        </div>
      ) : null}
      {value.map((action, index) => (
        <div
          key={index}
          className='flex flex-col gap-3 rounded-lg border border-border bg-background p-3'
        >
          <div className='flex items-center gap-2'>
            <Badge variant='secondary'>{index + 1}</Badge>
            <div className='flex min-w-0 flex-1 flex-col'>
              <span className='text-sm font-medium'>
                {SD_AUTOMATION_ACTION_META[action.type].label}
              </span>
              <span className='text-xs text-muted-foreground'>
                {SD_AUTOMATION_ACTION_META[action.type].description}
              </span>
            </div>
            {!disabled ? (
              <>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Subir'
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Descer'
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Remover ação'
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                </Button>
              </>
            ) : null}
          </div>
          <ActionParams
            action={action}
            disabled={disabled}
            onChange={(next) =>
              onChange(value.map((a, i) => (i === index ? next : a)))
            }
          />
        </div>
      ))}
      {!disabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='self-start'
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Adicionar ação
              </Button>
            }
          />
          <DropdownMenuContent className='w-72'>
            {(Object.keys(SD_AUTOMATION_ACTION_META) as ActionType[]).map(
              (type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onChange([...value, defaultAction(type)])}
                  className='flex-col items-start gap-0'
                >
                  <span>{SD_AUTOMATION_ACTION_META[type].label}</span>
                  <span className='text-xs text-muted-foreground'>
                    {SD_AUTOMATION_ACTION_META[type].description}
                  </span>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

// ── Ações de escalonamento ─────────────────────────────────────────────────

export const SD_DEFAULT_ESCALATION_ACTIONS: SdEscalationActions = {
  kind: 'HIERARCHICAL',
  notifyUserIds: [],
  notifyAssignee: true,
  notifyDepartmentLeads: true,
  reassignDepartmentId: null,
  reassignUserId: null,
  raisePriority: false,
  email: false,
  notifyOnCall: false,
  reassignToOnCall: false,
}

/** Editor controlado de `SdEscalationActions`. */
export function SdEscalationActionsEditor({
  value,
  onChange,
  disabled,
}: {
  value: SdEscalationActions
  onChange: (value: SdEscalationActions) => void
  disabled?: boolean
}) {
  const { users, departments } = useFieldOptions()
  const set = (patch: Partial<SdEscalationActions>) =>
    onChange({ ...value, ...patch })
  const functionalMissing =
    value.kind === 'FUNCTIONAL' &&
    !value.reassignDepartmentId &&
    !value.reassignUserId &&
    !value.reassignToOnCall

  return (
    <div className='flex flex-col gap-3'>
      <FieldBlock label='Tipo de escalonamento'>
        <SimpleSelect
          value={value.kind}
          options={[
            {
              value: 'HIERARCHICAL',
              label: 'Hierárquico — sobe para o líder / próximo nível',
            },
            {
              value: 'FUNCTIONAL',
              label: 'Funcional — passa para outro time ou pessoa',
            },
          ]}
          disabled={disabled}
          onChange={(kind) => set({ kind: kind ?? 'HIERARCHICAL' })}
        />
      </FieldBlock>
      <div className='grid gap-2 md:grid-cols-2'>
        <FieldBlock label='Reatribuir ao departamento'>
          <SimpleSelect
            value={value.reassignDepartmentId}
            options={departments}
            allowEmpty
            emptyLabel='Manter'
            disabled={disabled}
            onChange={(id) => set({ reassignDepartmentId: id })}
          />
        </FieldBlock>
        <FieldBlock label='Reatribuir ao usuário'>
          <SimpleSelect
            value={value.reassignUserId}
            options={users}
            allowEmpty
            emptyLabel='Manter'
            disabled={disabled}
            onChange={(id) => set({ reassignUserId: id })}
          />
        </FieldBlock>
      </div>
      {functionalMissing ? (
        <p className='text-xs text-destructive'>
          Escalonamento funcional exige um departamento, um responsável de
          destino ou o plantão.
        </p>
      ) : null}
      <div className='flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2'>
        <span className='font-medium text-xs'>Plantão (on-call)</span>
        <ToggleRow
          label='Passar para quem está de plantão'
          description='Camada 1 no primeiro nível, camada seguinte a cada nível. Dentro do expediente da escala, ou sem ninguém de plantão, vale o destino acima.'
          checked={value.reassignToOnCall}
          disabled={disabled}
          onCheckedChange={(v) => set({ reassignToOnCall: v })}
        />
        <ToggleRow
          label='Avisar o plantão e a retaguarda'
          checked={value.notifyOnCall}
          disabled={disabled}
          onCheckedChange={(v) => set({ notifyOnCall: v })}
        />
      </div>
      <div className='grid gap-x-4 sm:grid-cols-2'>
        <ToggleRow
          label='Notificar o responsável'
          checked={value.notifyAssignee}
          disabled={disabled}
          onCheckedChange={(v) => set({ notifyAssignee: v })}
        />
        <ToggleRow
          label='Notificar líderes do departamento'
          checked={value.notifyDepartmentLeads}
          disabled={disabled}
          onCheckedChange={(v) => set({ notifyDepartmentLeads: v })}
        />
        <ToggleRow
          label='Também por e-mail'
          checked={value.email}
          disabled={disabled}
          onCheckedChange={(v) => set({ email: v })}
        />
        <ToggleRow
          label='Subir a prioridade'
          description='Passa para o próximo peso.'
          checked={value.raisePriority}
          disabled={disabled}
          onCheckedChange={(v) => set({ raisePriority: v })}
        />
      </div>
      <FieldBlock label='Notificar também'>
        <MultiChips
          options={users}
          value={value.notifyUserIds}
          disabled={disabled}
          onChange={(notifyUserIds) => set({ notifyUserIds })}
        />
      </FieldBlock>
    </div>
  )
}

/** Resumo de ações de escalonamento para a lista. */
export function summarizeSdEscalationActions(
  actions: SdEscalationActions,
): ReactNode {
  const parts: string[] = [
    actions.kind === 'FUNCTIONAL' ? 'Funcional' : 'Hierárquico',
  ]
  if (actions.notifyAssignee) parts.push('avisa responsável')
  if (actions.notifyDepartmentLeads) parts.push('avisa líderes')
  if (actions.notifyUserIds.length)
    parts.push(`+${actions.notifyUserIds.length} pessoa(s)`)
  if (actions.reassignDepartmentId || actions.reassignUserId)
    parts.push('reatribui')
  if (actions.reassignToOnCall) parts.push('passa ao plantão')
  if (actions.notifyOnCall) parts.push('avisa plantão')
  if (actions.raisePriority) parts.push('sobe prioridade')
  if (actions.email) parts.push('e-mail')
  return parts.join(' · ')
}
