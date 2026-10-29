'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  changeFieldType,
  FIELD_TYPE_OPTIONS,
  MAPPING_OPTIONS,
  mappingValue,
  NEEDS_OPTIONS,
  parseMappingValue,
} from '@/src/lib/whatsapp/flows/editor-model'
import {
  FLOW_LIMITS,
  type FlowField,
  type FlowFieldType,
} from '@/src/schemas/whatsapp-flow.schema'
import { SimpleSelect } from '../chatbots/chatbot-select'

function nextOptionId(field: FlowField): string {
  const taken = new Set((field.options ?? []).map((o) => o.id))
  let n = (field.options?.length ?? 0) + 1
  while (taken.has(`opcao_${n}`)) n += 1
  return `opcao_${n}`
}

/** One field of a screen: type, label, options and where the answer goes. */
export function FlowFieldEditor({
  field,
  index,
  total,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  field: FlowField
  index: number
  total: number
  readOnly: boolean
  onChange: (field: FlowField) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const id = `field-${field.key}`
  const labelMax = FLOW_LIMITS.label[field.type]
  const hasOptions = NEEDS_OPTIONS.has(field.type)
  const options = field.options ?? []

  return (
    <li className='space-y-3 rounded-lg border bg-background p-3'>
      <div className='grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]'>
        <div className='space-y-1.5'>
          <Label>Tipo</Label>
          <SimpleSelect
            ariaLabel={`Tipo do campo ${field.label}`}
            value={field.type}
            options={FIELD_TYPE_OPTIONS}
            disabled={readOnly}
            onChange={(type) =>
              onChange(changeFieldType(field, type as FlowFieldType))
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`${id}-label`}>Pergunta</Label>
          <Input
            id={`${id}-label`}
            value={field.label}
            maxLength={labelMax}
            disabled={readOnly}
            onChange={(event) =>
              onChange({ ...field, label: event.target.value })
            }
          />
          <p className='text-muted-foreground text-xs'>
            Até {labelMax} caracteres neste tipo de campo.
          </p>
        </div>
      </div>

      {field.type !== 'checkbox' ? (
        <div className='space-y-1.5'>
          <Label htmlFor={`${id}-helper`}>Texto de ajuda (opcional)</Label>
          <Input
            id={`${id}-helper`}
            value={field.helperText ?? ''}
            maxLength={80}
            disabled={readOnly}
            onChange={(event) =>
              onChange({
                ...field,
                helperText: event.target.value || undefined,
              })
            }
          />
        </div>
      ) : null}

      {hasOptions ? (
        <div className='space-y-2'>
          <Label>Opções</Label>
          <ul className='space-y-2'>
            {options.map((option, optionIndex) => (
              <li key={option.id} className='flex items-center gap-2'>
                <Input
                  aria-label={`Opção ${optionIndex + 1} de ${field.label}`}
                  value={option.title}
                  maxLength={30}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange({
                      ...field,
                      options: options.map((o, i) =>
                        i === optionIndex
                          ? { ...o, title: event.target.value }
                          : o,
                      ),
                    })
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={`Remover opção ${option.title}`}
                  disabled={readOnly || options.length <= 1}
                  onClick={() =>
                    onChange({
                      ...field,
                      options: options.filter((_, i) => i !== optionIndex),
                    })
                  }
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={readOnly || options.length >= FLOW_LIMITS.options}
            onClick={() =>
              onChange({
                ...field,
                options: [
                  ...options,
                  {
                    id: nextOptionId(field),
                    title: `Opção ${options.length + 1}`,
                  },
                ],
              })
            }
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Adicionar opção
          </Button>
        </div>
      ) : null}

      <div className='space-y-1.5'>
        <Label>Guardar a resposta em</Label>
        <SimpleSelect
          ariaLabel={`Destino da resposta ${field.label}`}
          value={mappingValue(field)}
          options={MAPPING_OPTIONS}
          disabled={readOnly}
          onChange={(value) =>
            onChange({ ...field, mapping: parseMappingValue(value) })
          }
        />
      </div>

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Switch
            id={`${id}-required`}
            checked={field.required}
            disabled={readOnly}
            onCheckedChange={(required) => onChange({ ...field, required })}
          />
          <Label htmlFor={`${id}-required`}>Obrigatório</Label>
        </div>
        {readOnly ? null : (
          <div className='flex items-center gap-1'>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={`Subir ${field.label}`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={`Descer ${field.label}`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={`Remover ${field.label}`}
              disabled={total <= 1}
              onClick={onRemove}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
