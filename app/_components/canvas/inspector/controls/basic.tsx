'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useCanvasEditor } from '../../editor-context'
import { optionIcon } from './option-icons'
import {
  type ControlProps,
  inputClass,
  NumberInput,
  Segmented,
} from './primitives'

export function TextControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'text', string>) {
  return (
    <input
      id={id}
      aria-label={label}
      value={value ?? ''}
      placeholder={control.placeholder}
      maxLength={control.maxLength}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
    />
  )
}

export function TextareaControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'textarea', string>) {
  const length = value?.length ?? 0
  return (
    <div className='relative'>
      <textarea
        id={id}
        aria-label={label}
        value={value ?? ''}
        placeholder={control.placeholder}
        maxLength={control.maxLength}
        rows={control.rows ?? 3}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, 'h-auto resize-y py-1.5 leading-relaxed')}
      />
      {control.maxLength && (
        <span className='pointer-events-none absolute right-2 bottom-1.5 text-[10px] text-muted-foreground tabular-nums'>
          {length}/{control.maxLength}
        </span>
      )}
    </div>
  )
}

export function NumberControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'number', number>) {
  const hasRange = control.min !== undefined && control.max !== undefined
  return (
    <div className='flex items-center gap-2'>
      {hasRange && (
        <input
          type='range'
          aria-hidden
          tabIndex={-1}
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          value={value ?? control.min}
          onChange={(event) => onChange(Number(event.target.value))}
          className='h-1 min-w-0 flex-1 cursor-pointer accent-primary'
        />
      )}
      <NumberInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        min={control.min}
        max={control.max}
        step={control.step}
        unit={control.unit}
        allowEmpty
        className={hasRange ? 'w-20 shrink-0' : undefined}
      />
    </div>
  )
}

export function SelectControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'select', string>) {
  const labels = Object.fromEntries(
    control.options.map((option) => [option.value, option.label]),
  )
  return (
    <Select
      value={value ?? null}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        size='sm'
        className='w-full text-xs'
      >
        <SelectValue placeholder='Selecione'>
          {(current: string | null) =>
            current ? (labels[current] ?? current) : 'Selecione'
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {control.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className='text-xs'
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SegmentedControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'segmented', string>) {
  const { catalog } = useCanvasEditor()
  return (
    <Segmented
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      options={control.options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: optionIcon(catalog, option.icon),
      }))}
    />
  )
}

export function ToggleControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'toggle', boolean>) {
  return (
    <Switch
      id={id}
      aria-label={label}
      checked={!!value}
      onCheckedChange={(checked) => onChange(checked)}
    />
  )
}
