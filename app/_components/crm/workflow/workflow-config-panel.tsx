'use client'

import {
  Add01Icon,
  Cancel01Icon,
  Delete01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetClose } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  CRM_WORKFLOW_DELAY_UNITS,
  CRM_WORKFLOW_ENTITIES,
  CRM_WORKFLOW_FILTER_OPERATORS,
  CRM_WORKFLOW_FORM_FIELD_TYPES,
  CRM_WORKFLOW_LEAD_EVENTS,
  CRM_WORKFLOW_TRIGGER_ENTITIES,
  type CrmWorkflowLeadEvent,
  type CrmWorkflowNode,
  type CrmWorkflowNodeData,
  type CrmWorkflowTrigger,
  type CrmWorkflowTriggerData,
} from '@/src/schemas/crm-workflow.schema'
import {
  WORKFLOW_DELAY_UNIT_LABELS,
  WORKFLOW_ENTITY_LABELS,
  WORKFLOW_FORM_FIELD_TYPE_LABELS,
  WORKFLOW_OPERATOR_LABELS,
  WORKFLOW_TRIGGER_LABELS,
  webhookTriggerPath,
  workflowNodeLabel,
} from './workflow-labels'

export function WorkflowConfigPanel({
  selectedId,
  trigger,
  node,
  onUpdateTrigger,
  onUpdateNode,
  onDeleteNode,
  onClose,
}: {
  selectedId: string | null
  trigger: CrmWorkflowTrigger
  node: CrmWorkflowNode | null
  onUpdateTrigger: (data: CrmWorkflowTriggerData | null) => void
  onUpdateNode: (id: string, data: CrmWorkflowNodeData) => void
  onDeleteNode: (id: string) => void
  onClose: () => void
}) {
  if (selectedId === 'trigger') {
    return (
      <PanelShell
        title='Configurar gatilho'
        onClose={onClose}
        onDelete={trigger.data ? () => onUpdateTrigger(null) : undefined}
        deleteLabel='Limpar gatilho'
      >
        <TriggerForm data={trigger.data} onChange={onUpdateTrigger} />
      </PanelShell>
    )
  }
  if (node) {
    return (
      <PanelShell
        title={node.data.label || workflowNodeLabel(node.data.type)}
        onClose={onClose}
        onDelete={() => onDeleteNode(node.id)}
        deleteLabel='Excluir etapa'
      >
        <NodeForm
          node={node}
          onChange={(data) => onUpdateNode(node.id, data)}
        />
      </PanelShell>
    )
  }
  return null
}

function PanelShell({
  title,
  children,
  onClose,
  onDelete,
  deleteLabel,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  onDelete?: () => void
  deleteLabel?: string
}) {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
        <span className='truncate font-semibold text-sm'>{title}</span>
        <SheetClose
          className='ml-auto'
          nativeButton={true}
          render={
            <Button variant='ghost' size='icon-sm' aria-label='Fechar'>
              <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          }
          onClick={onClose}
        />
      </div>
      <div className='min-h-0 flex-1 space-y-4 overflow-auto p-4'>
        {children}
      </div>
      {onDelete && (
        <div className='border-t p-3'>
          <Button
            size='sm'
            variant='destructive'
            className='w-full'
            onClick={onDelete}
          >
            <SteelIcon icon={Delete01Icon} strokeWidth={2} />
            {deleteLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

/* ============================== trigger form =========================== */

const TRIGGER_ENTITY_LABELS: Record<
  (typeof CRM_WORKFLOW_TRIGGER_ENTITIES)[number],
  string
> = {
  ...WORKFLOW_ENTITY_LABELS,
  lead: 'Lead',
}

const LEAD_EVENT_LABELS: Record<CrmWorkflowLeadEvent, string> = {
  'stage-changed': 'Etapa alterada',
  won: 'Fechado como ganho',
  lost: 'Fechado como perdido',
}

function TriggerForm({
  data,
  onChange,
}: {
  data: CrmWorkflowTriggerData | null
  onChange: (next: CrmWorkflowTriggerData | null) => void
}) {
  if (!data) {
    return (
      <p className='text-muted-foreground text-sm'>
        Selecione um tipo de gatilho no menu "Adicionar etapa".
      </p>
    )
  }
  return (
    <div className='space-y-4'>
      <Field label='Tipo'>
        <ReadOnlyValue>{WORKFLOW_TRIGGER_LABELS[data.type]}</ReadOnlyValue>
      </Field>
      {(data.type === 'record-is-created' ||
        data.type === 'record-is-deleted' ||
        data.type === 'record-is-updated' ||
        data.type === 'record-is-created-or-updated') && (
        <Field label='Entidade'>
          <NativeSelect
            value={data.entity}
            options={CRM_WORKFLOW_TRIGGER_ENTITIES.map((e) => ({
              value: e,
              label: TRIGGER_ENTITY_LABELS[e],
            }))}
            onChange={(v) => {
              const entity = v as (typeof CRM_WORKFLOW_TRIGGER_ENTITIES)[number]
              // `leadEvent` só vale para lead — descarta ao trocar de entidade.
              if ('leadEvent' in data && entity !== 'lead') {
                const { leadEvent: _drop, ...rest } = data
                onChange({ ...rest, entity })
                return
              }
              onChange({ ...data, entity })
            }}
          />
        </Field>
      )}
      {(data.type === 'record-is-updated' ||
        data.type === 'record-is-created-or-updated') &&
        data.entity === 'lead' && (
          <Field
            label='Evento do lead'
            hint='Filtra a atualização por um evento do painel de leads.'
          >
            <NativeSelect
              value={data.leadEvent ?? ''}
              options={[
                { value: '', label: 'Qualquer atualização' },
                ...CRM_WORKFLOW_LEAD_EVENTS.map((e) => ({
                  value: e,
                  label: LEAD_EVENT_LABELS[e],
                })),
              ]}
              onChange={(v) =>
                onChange({
                  ...data,
                  leadEvent: v ? (v as CrmWorkflowLeadEvent) : undefined,
                })
              }
            />
          </Field>
        )}
      {(data.type === 'record-is-updated' ||
        data.type === 'record-is-created-or-updated') && (
        <Field
          label='Campos observados'
          hint='Vazio = qualquer campo. Separe por vírgula.'
        >
          <Input
            value={data.fields.join(',')}
            onChange={(e) =>
              onChange({
                ...data,
                fields: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      )}
      {data.type === 'launch-manually' && (
        <p className='text-muted-foreground text-sm'>
          Sem configuração: dispare pelo botão "Testar" ou por um disparo
          manual.
        </p>
      )}
      {data.type === 'on-a-schedule' && (
        <>
          <Field label='Agenda (cron)'>
            <Input
              value={data.cron}
              onChange={(e) => onChange({ ...data, cron: e.target.value })}
              placeholder='0 9 * * *'
            />
          </Field>
          <Field label='Fuso horário'>
            <Input
              value={data.timezone}
              onChange={(e) => onChange({ ...data, timezone: e.target.value })}
              placeholder='America/Sao_Paulo'
            />
          </Field>
        </>
      )}
      {data.type === 'webhook' && (
        <Field
          label='Token do webhook'
          hint={`Endereço: POST ${webhookTriggerPath('<token>')}`}
        >
          <Input
            value={data.token}
            onChange={(e) => onChange({ ...data, token: e.target.value })}
          />
        </Field>
      )}
    </div>
  )
}

/* ================================ node form ============================ */

function NodeForm({
  node,
  onChange,
}: {
  node: CrmWorkflowNode
  onChange: (data: CrmWorkflowNodeData) => void
}) {
  const { data } = node
  return (
    <div className='space-y-4'>
      <Field label='Rótulo'>
        <Input
          value={data.label ?? ''}
          onChange={(e) =>
            onChange({ ...data, label: e.target.value } as CrmWorkflowNodeData)
          }
        />
      </Field>
      <Field label='Alias de saída' hint='Usado em {{steps.<alias>.output}}'>
        <Input
          value={data.outputAlias ?? ''}
          onChange={(e) =>
            onChange({
              ...data,
              outputAlias: e.target.value || undefined,
            } as CrmWorkflowNodeData)
          }
        />
      </Field>
      {renderBody(data, onChange)}
    </div>
  )
}

function renderBody(
  data: CrmWorkflowNodeData,
  onChange: (next: CrmWorkflowNodeData) => void,
) {
  switch (data.type) {
    case 'create-record':
      return (
        <>
          <EntityField data={data} onChange={onChange} />
          <FieldMapEditor
            label='Campos'
            value={data.fields}
            onChange={(fields) => onChange({ ...data, fields })}
          />
        </>
      )
    case 'update-record':
      return (
        <>
          <EntityField data={data} onChange={onChange} />
          <Field label='ID do registro (expressão)'>
            <Input
              value={data.recordId}
              onChange={(e) => onChange({ ...data, recordId: e.target.value })}
              placeholder='{{trigger.record.id}}'
            />
          </Field>
          <FieldMapEditor
            label='Campos a atualizar'
            value={data.fields}
            onChange={(fields) => onChange({ ...data, fields })}
          />
        </>
      )
    case 'delete-record':
      return (
        <>
          <EntityField data={data} onChange={onChange} />
          <Field label='ID do registro (expressão)'>
            <Input
              value={data.recordId}
              onChange={(e) => onChange({ ...data, recordId: e.target.value })}
              placeholder='{{trigger.record.id}}'
            />
          </Field>
        </>
      )
    case 'search-records':
      return (
        <>
          <EntityField data={data} onChange={onChange} />
          <Field label='Limite'>
            <Input
              type='number'
              value={data.limit}
              onChange={(e) =>
                onChange({ ...data, limit: Number(e.target.value) || 50 })
              }
            />
          </Field>
          <ConditionsEditor
            label='Condições'
            value={data.conditions}
            onChange={(conditions) => onChange({ ...data, conditions })}
          />
        </>
      )
    case 'create-or-update-record':
      return (
        <>
          <EntityField data={data} onChange={onChange} />
          <Field label='Campo de busca'>
            <Input
              value={data.lookupField}
              onChange={(e) =>
                onChange({ ...data, lookupField: e.target.value })
              }
              placeholder='domain'
            />
          </Field>
          <Field label='Valor de busca (expressão)'>
            <Input
              value={data.lookupValue}
              onChange={(e) =>
                onChange({ ...data, lookupValue: e.target.value })
              }
            />
          </Field>
          <FieldMapEditor
            label='Campos'
            value={data.fields}
            onChange={(fields) => onChange({ ...data, fields })}
          />
        </>
      )
    case 'iterator':
      return (
        <>
          <Field label='Origem (expressão)'>
            <Input
              value={data.source}
              onChange={(e) => onChange({ ...data, source: e.target.value })}
              placeholder='{{steps.search_1.output}}'
            />
          </Field>
          <Field label='Alias do item'>
            <Input
              value={data.itemAlias}
              onChange={(e) =>
                onChange({ ...data, itemAlias: e.target.value || 'item' })
              }
            />
          </Field>
        </>
      )
    case 'filter':
      return (
        <ConditionsEditor
          label='Condições (AND)'
          value={data.conditions}
          onChange={(conditions) => onChange({ ...data, conditions })}
        />
      )
    case 'if-else':
      return (
        <ConditionsEditor
          label='Condições (segue por "sim" se todas baterem)'
          value={data.conditions}
          onChange={(conditions) => onChange({ ...data, conditions })}
        />
      )
    case 'delay':
      return (
        <div className='grid grid-cols-2 gap-2'>
          <Field label='Quantidade'>
            <Input
              type='number'
              value={data.amount}
              onChange={(e) =>
                onChange({ ...data, amount: Number(e.target.value) || 1 })
              }
            />
          </Field>
          <Field label='Unidade'>
            <NativeSelect
              value={data.unit}
              options={CRM_WORKFLOW_DELAY_UNITS.map((u) => ({
                value: u,
                label: WORKFLOW_DELAY_UNIT_LABELS[u],
              }))}
              onChange={(unit) =>
                onChange({
                  ...data,
                  unit: unit as (typeof CRM_WORKFLOW_DELAY_UNITS)[number],
                })
              }
            />
          </Field>
        </div>
      )
    case 'send-email':
    case 'draft-email':
      return (
        <>
          <Field label='Para (e-mail/expressão)'>
            <Input
              value={data.to}
              onChange={(e) => onChange({ ...data, to: e.target.value })}
              placeholder='{{trigger.record.emails.0}}'
            />
          </Field>
          <Field label='Assunto'>
            <Input
              value={data.subject}
              onChange={(e) => onChange({ ...data, subject: e.target.value })}
            />
          </Field>
          <Field label='Corpo (HTML)'>
            <textarea
              value={data.body}
              onChange={(e) => onChange({ ...data, body: e.target.value })}
              rows={6}
              className='w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm'
            />
          </Field>
        </>
      )
    case 'form':
      return <FormFieldsEditor data={data} onChange={onChange} />
  }
}

/* ============================ small helpers ============================ */

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      {children}
      {hint && <p className='text-muted-foreground/70 text-xs'>{hint}</p>}
    </div>
  )
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <div className='rounded-md border bg-muted/30 px-2 py-1.5 text-sm'>
      {children}
    </div>
  )
}

function NativeSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <select
      className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function EntitySelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: (typeof CRM_WORKFLOW_ENTITIES)[number]) => void
}) {
  return (
    <NativeSelect
      value={value}
      options={CRM_WORKFLOW_ENTITIES.map((e) => ({
        value: e,
        label: WORKFLOW_ENTITY_LABELS[e],
      }))}
      onChange={(v) => onChange(v as (typeof CRM_WORKFLOW_ENTITIES)[number])}
    />
  )
}

function EntityField({
  data,
  onChange,
}: {
  data: Extract<
    CrmWorkflowNodeData,
    {
      type:
        | 'create-record'
        | 'update-record'
        | 'delete-record'
        | 'search-records'
        | 'create-or-update-record'
    }
  >
  onChange: (next: CrmWorkflowNodeData) => void
}) {
  return (
    <Field label='Entidade'>
      <EntitySelect
        value={data.entity}
        onChange={(entity) =>
          onChange({ ...data, entity } as CrmWorkflowNodeData)
        }
      />
    </Field>
  )
}

/* ========================== field map editor =========================== */

function FieldMapEditor({
  label,
  value,
  onChange,
}: {
  label: string
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const [draft, setDraft] = useState<Array<[string, string]>>([])
  useEffect(() => {
    setDraft(Object.entries(value))
  }, [value])

  const commit = (next: Array<[string, string]>) => {
    setDraft(next)
    const out: Record<string, string> = {}
    for (const [k, v] of next) if (k) out[k] = v
    onChange(out)
  }

  return (
    <div className='space-y-2'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <div className='space-y-1.5'>
        {draft.map((entry, i) => (
          <div
            key={`row-${i}-${entry[0]}`}
            className='flex items-center gap-1.5'
          >
            <Input
              className='h-8 flex-1'
              placeholder='campo'
              defaultValue={entry[0]}
              onBlur={(e) =>
                commit(
                  draft.map((row, idx) =>
                    idx === i ? [e.target.value, row[1]] : row,
                  ),
                )
              }
            />
            <Input
              className='h-8 flex-[2]'
              placeholder='valor / {{expressão}}'
              defaultValue={entry[1]}
              onBlur={(e) =>
                commit(
                  draft.map((row, idx) =>
                    idx === i ? [row[0], e.target.value] : row,
                  ),
                )
              }
            />
            <Button
              size='icon-xs'
              aria-label='Remover campo'
              variant='ghost'
              onClick={() => commit(draft.filter((_, idx) => idx !== i))}
            >
              <SteelIcon icon={Delete01Icon} strokeWidth={2} />
            </Button>
          </div>
        ))}
      </div>
      <Button
        size='xs'
        variant='ghost'
        onClick={() => commit([...draft, ['', '']])}
      >
        <SteelIcon icon={Add01Icon} strokeWidth={2} />
        Adicionar campo
      </Button>
    </div>
  )
}

/* ========================== conditions editor ========================== */

type ConditionRow = {
  field: string
  operator: (typeof CRM_WORKFLOW_FILTER_OPERATORS)[number]
  value: string
}

function ConditionsEditor({
  label,
  value,
  onChange,
}: {
  label: string
  value: ConditionRow[]
  onChange: (next: ConditionRow[]) => void
}) {
  const update = (i: number, patch: Partial<ConditionRow>) => {
    const next = value.map((row, idx) =>
      idx === i ? { ...row, ...patch } : row,
    )
    onChange(next)
  }
  return (
    <div className='space-y-2'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <div className='space-y-1.5'>
        {value.map((row, i) => (
          <div key={`cond-${i}`} className='grid grid-cols-12 gap-1.5'>
            <Input
              className='col-span-5 h-8'
              placeholder='campo / {{expressão}}'
              value={row.field}
              onChange={(e) => update(i, { field: e.target.value })}
            />
            <div className='col-span-3'>
              <NativeSelect
                value={row.operator}
                options={CRM_WORKFLOW_FILTER_OPERATORS.map((o) => ({
                  value: o,
                  label: WORKFLOW_OPERATOR_LABELS[o],
                }))}
                onChange={(v) =>
                  update(i, {
                    operator:
                      v as (typeof CRM_WORKFLOW_FILTER_OPERATORS)[number],
                  })
                }
              />
            </div>
            <Input
              className='col-span-3 h-8'
              placeholder='valor'
              value={row.value ?? ''}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <Button
              size='icon-xs'
              aria-label='Remover condição'
              variant='ghost'
              className='col-span-1'
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              <SteelIcon icon={Delete01Icon} strokeWidth={2} />
            </Button>
          </div>
        ))}
      </div>
      <Button
        size='xs'
        variant='ghost'
        onClick={() =>
          onChange([...value, { field: '', operator: 'equals', value: '' }])
        }
      >
        <SteelIcon icon={Add01Icon} strokeWidth={2} />
        Adicionar condição
      </Button>
    </div>
  )
}

/* =========================== form-fields editor ========================== */

function FormFieldsEditor({
  data,
  onChange,
}: {
  data: Extract<CrmWorkflowNodeData, { type: 'form' }>
  onChange: (next: CrmWorkflowNodeData) => void
}) {
  const update = (i: number, patch: Partial<(typeof data.fields)[number]>) => {
    const next = data.fields.map((f, idx) =>
      idx === i ? { ...f, ...patch } : f,
    )
    onChange({ ...data, fields: next })
  }
  return (
    <>
      <Field label='Título'>
        <Input
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <div className='space-y-2'>
        <Label className='text-muted-foreground text-xs'>Campos</Label>
        {data.fields.map((f, i) => (
          <div
            key={`f-${i}`}
            className='space-y-1.5 rounded-md border bg-card/50 p-2'
          >
            <div className='flex items-center gap-1.5'>
              <Input
                className='h-8 flex-1'
                placeholder='nome'
                value={f.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <div className='w-28'>
                <NativeSelect
                  value={f.type ?? 'text'}
                  options={CRM_WORKFLOW_FORM_FIELD_TYPES.map((t) => ({
                    value: t,
                    label: WORKFLOW_FORM_FIELD_TYPE_LABELS[t],
                  }))}
                  onChange={(v) =>
                    update(i, {
                      type: v as (typeof CRM_WORKFLOW_FORM_FIELD_TYPES)[number],
                    })
                  }
                />
              </div>
              <Button
                size='icon-xs'
                aria-label='Remover campo'
                variant='ghost'
                onClick={() =>
                  onChange({
                    ...data,
                    fields: data.fields.filter((_, idx) => idx !== i),
                  })
                }
              >
                <SteelIcon icon={Delete01Icon} strokeWidth={2} />
              </Button>
            </div>
            <div className='flex items-center gap-2'>
              <Switch
                checked={f.required}
                onCheckedChange={(checked) =>
                  update(i, { required: Boolean(checked) })
                }
              />
              <span className='text-muted-foreground text-xs'>Obrigatório</span>
            </div>
          </div>
        ))}
        <Button
          size='xs'
          variant='ghost'
          onClick={() =>
            onChange({
              ...data,
              fields: [
                ...data.fields,
                {
                  name: `field_${data.fields.length + 1}`,
                  type: 'text',
                  required: false,
                },
              ],
            })
          }
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Adicionar campo
        </Button>
      </div>
    </>
  )
}
