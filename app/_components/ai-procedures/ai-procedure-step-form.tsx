'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type { AiProcedureCatalogDTO } from '@/types/ai-procedure'
import {
  blankStep,
  OPERATOR_LABEL,
  OPERATORS_WITHOUT_VALUE,
  STEP_KIND_LABEL,
  VALIDATION_LABEL,
} from './ai-procedure-labels'

type Save = { variable: string; path: string }

function SavesEditor({
  saves,
  disabled,
  onChange,
}: {
  saves: Save[]
  disabled: boolean
  onChange: (next: Save[]) => void
}) {
  return (
    <Field>
      <FieldLabel>Guardar da resposta</FieldLabel>
      {saves.map((save, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
        <div key={index} className='flex flex-wrap items-center gap-2'>
          <Input
            aria-label='Nome da variável'
            className='w-40'
            value={save.variable}
            disabled={disabled}
            placeholder='variavel'
            onChange={(e) =>
              onChange(
                saves.map((s, i) =>
                  i === index ? { ...s, variable: e.target.value } : s,
                ),
              )
            }
          />
          <Input
            aria-label='Caminho no JSON'
            className='min-w-0 flex-1'
            value={save.path}
            disabled={disabled}
            placeholder='dados.0.link'
            onChange={(e) =>
              onChange(
                saves.map((s, i) =>
                  i === index ? { ...s, path: e.target.value } : s,
                ),
              )
            }
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Remover'
            disabled={disabled}
            onClick={() => onChange(saves.filter((_, i) => i !== index))}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || saves.length >= 5}
          onClick={() => onChange([...saves, { variable: '', path: '' }])}
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Guardar valor
        </Button>
      </div>
      <FieldDescription>
        O valor fica numa variável que os passos seguintes usam como{' '}
        {'{{variavel}}'}.
      </FieldDescription>
    </Field>
  )
}

export function AiProcedureStepForm({
  step,
  index,
  total,
  catalog,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  step: ProcedureStep
  index: number
  total: number
  catalog: AiProcedureCatalogDTO | undefined
  disabled: boolean
  onChange: (next: ProcedureStep) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const patch = (changes: Record<string, unknown>) =>
    onChange({ ...step, ...changes } as ProcedureStep)
  const condition = step.condition
  const operators = catalog?.operators ?? Object.keys(OPERATOR_LABEL)

  return (
    <li className='space-y-3 rounded-xl border bg-card p-3 sm:p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant='secondary'>Passo {index + 1}</Badge>
        {step.required ? (
          <Badge variant='outline'>Obrigatório</Badge>
        ) : (
          <Badge variant='outline'>Opcional</Badge>
        )}
        <div className='ml-auto flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Mover para cima'
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Mover para baixo'
            disabled={disabled || index === total - 1}
            onClick={() => onMove(1)}
          >
            <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Remover passo'
            disabled={disabled || total <= 1}
            onClick={onRemove}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel>O que este passo faz</FieldLabel>
          <Select
            items={Object.entries(STEP_KIND_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
            value={step.kind}
            disabled={disabled}
            onValueChange={(next) => {
              if (next && next !== step.kind) {
                onChange({
                  ...blankStep(
                    next as ProcedureStep['kind'],
                    step.key,
                    step.title,
                  ),
                  required: step.required,
                  condition: step.condition ?? null,
                } as ProcedureStep)
              }
            }}
          >
            <SelectTrigger aria-label='Tipo de passo' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STEP_KIND_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`title-${step.key}`}>Nome do passo</FieldLabel>
          <Input
            id={`title-${step.key}`}
            value={step.title}
            maxLength={80}
            disabled={disabled}
            placeholder='Ex.: Validar o CPF'
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
      </div>

      {step.kind === 'COLLECT' ? (
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field className='sm:col-span-2'>
            <FieldLabel>O que pedir ao cliente</FieldLabel>
            <Textarea
              rows={2}
              maxLength={500}
              value={step.prompt}
              disabled={disabled}
              placeholder='Ex.: o CPF do titular do boleto'
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>Variável</FieldLabel>
            <Input
              value={step.variable}
              disabled={disabled}
              placeholder='cpf'
              onChange={(e) => patch({ variable: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>Validação</FieldLabel>
            <Select
              items={Object.entries(VALIDATION_LABEL).map(
                ([value, label]) => ({ value, label }),
              )}
              value={step.validation}
              disabled={disabled}
              onValueChange={(next) => next && patch({ validation: next })}
            >
              <SelectTrigger aria-label='Validação' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VALIDATION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      {step.kind === 'HTTP' ? (
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
            <Field>
              <FieldLabel>Método</FieldLabel>
              <Select
                items={[
                  { value: 'GET', label: 'GET' },
                  { value: 'POST', label: 'POST' },
                ]}
                value={step.method}
                disabled={disabled}
                onValueChange={(next) => next && patch({ method: next })}
              >
                <SelectTrigger aria-label='Método' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='GET'>GET</SelectItem>
                  <SelectItem value='POST'>POST</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Endereço</FieldLabel>
              <Input
                value={step.url}
                maxLength={500}
                disabled={disabled}
                placeholder='https://api.exemplo.com.br/boletos?cpf={{cpf}}'
                onChange={(e) => patch({ url: e.target.value })}
              />
            </Field>
          </div>
          {step.method === 'POST' ? (
            <Field>
              <FieldLabel>Corpo (JSON)</FieldLabel>
              <Textarea
                rows={3}
                maxLength={2000}
                value={step.body ?? ''}
                disabled={disabled}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </Field>
          ) : null}
          <SavesEditor
            saves={step.saves}
            disabled={disabled}
            onChange={(saves) => patch({ saves })}
          />
        </div>
      ) : null}

      {step.kind === 'TOOL' ? (
        <div className='space-y-3'>
          <Field>
            <FieldLabel>Ferramenta (somente leitura)</FieldLabel>
            <Select
              items={(catalog?.tools ?? []).map((tool) => ({
                value: tool.name,
                label: tool.label,
              }))}
              value={step.toolName || null}
              disabled={disabled}
              onValueChange={(next) => next && patch({ toolName: next })}
            >
              <SelectTrigger aria-label='Ferramenta' className='w-full'>
                <SelectValue placeholder='Escolha uma ferramenta' />
              </SelectTrigger>
              <SelectContent>
                {(catalog?.tools ?? []).map((tool) => (
                  <SelectItem key={tool.name} value={tool.name}>
                    {tool.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Parâmetros</FieldLabel>
            {Object.entries(step.args).map(([name, value]) => (
              <div key={name} className='flex flex-wrap items-center gap-2'>
                <Input className='w-40' value={name} disabled readOnly />
                <Input
                  className='min-w-0 flex-1'
                  value={value}
                  disabled={disabled}
                  placeholder='{{variavel}} ou um valor fixo'
                  onChange={(e) =>
                    patch({ args: { ...step.args, [name]: e.target.value } })
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label='Remover parâmetro'
                  disabled={disabled}
                  onClick={() => {
                    const { [name]: _removed, ...rest } = step.args
                    patch({ args: rest })
                  }}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled || Object.keys(step.args).length >= 10}
                onClick={() => {
                  const name = window.prompt('Nome do parâmetro')?.trim()
                  if (name) patch({ args: { ...step.args, [name]: '' } })
                }}
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Parâmetro
              </Button>
            </div>
          </Field>
          <SavesEditor
            saves={step.saves}
            disabled={disabled}
            onChange={(saves) => patch({ saves })}
          />
        </div>
      ) : null}

      {step.kind === 'MESSAGE' ? (
        <div className='space-y-3'>
          <Field>
            <FieldLabel>Texto fixo (enviado como está)</FieldLabel>
            <Textarea
              rows={3}
              maxLength={1000}
              value={step.text ?? ''}
              disabled={disabled}
              placeholder='Aqui está sua segunda via: {{link}}'
              onChange={(e) => patch({ text: e.target.value })}
            />
            <FieldDescription>
              Deixe em branco para a IA escrever a mensagem seguindo a
              instrução abaixo.
            </FieldDescription>
          </Field>
          {!step.text ? (
            <Field>
              <FieldLabel>Instrução para a IA</FieldLabel>
              <Textarea
                rows={2}
                maxLength={500}
                value={step.instruction ?? ''}
                disabled={disabled}
                onChange={(e) => patch({ instruction: e.target.value })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {step.kind === 'HANDOFF' ? (
        <Field>
          <FieldLabel>Mensagem ao cliente (opcional)</FieldLabel>
          <Textarea
            rows={2}
            maxLength={1000}
            value={step.text ?? ''}
            disabled={disabled}
            onChange={(e) => patch({ text: e.target.value })}
          />
        </Field>
      ) : null}

      <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
        <label className='flex items-center gap-2 text-sm'>
          <Switch
            checked={step.required}
            disabled={disabled}
            onCheckedChange={(checked) => patch({ required: checked })}
          />
          Obrigatório
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <Switch
            checked={Boolean(condition)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              patch({
                condition: checked
                  ? { variable: '', operator: 'equals', value: '' }
                  : null,
              })
            }
          />
          Só quando…
        </label>
      </div>

      {condition ? (
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            aria-label='Variável da condição'
            className='w-36'
            value={condition.variable}
            disabled={disabled}
            placeholder='variavel'
            onChange={(e) =>
              patch({ condition: { ...condition, variable: e.target.value } })
            }
          />
          <Select
            items={operators.map((value) => ({
              value,
              label: OPERATOR_LABEL[value] ?? value,
            }))}
            value={condition.operator}
            disabled={disabled}
            onValueChange={(next) =>
              next && patch({ condition: { ...condition, operator: next } })
            }
          >
            <SelectTrigger aria-label='Operador' className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((value) => (
                <SelectItem key={value} value={value}>
                  {OPERATOR_LABEL[value] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {OPERATORS_WITHOUT_VALUE.has(condition.operator) ? null : (
            <Input
              aria-label='Valor da condição'
              className='min-w-0 flex-1'
              value={condition.value}
              disabled={disabled}
              onChange={(e) =>
                patch({ condition: { ...condition, value: e.target.value } })
              }
            />
          )}
        </div>
      ) : null}
    </li>
  )
}
