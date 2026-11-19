'use client'

import { type ReactNode, useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Label + control, the unit of the inspector. */
export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('grid gap-1', className)}>
      <Label htmlFor={id} className='text-muted-foreground text-xs'>
        {label}
      </Label>
      {children(id)}
    </div>
  )
}

const HEX6 = /^#[0-9a-fA-F]{6}/

/** Color picker + hex field; keeps an existing alpha suffix (#rrggbbaa). */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const alpha = value.length === 9 ? value.slice(7) : ''
  const solid = HEX6.test(value) ? value.slice(0, 7) : '#000000'
  return (
    <Field label={label}>
      {(id) => (
        <div className='flex items-center gap-2'>
          <input
            id={id}
            type='color'
            value={solid}
            onChange={(event) => onChange(`${event.target.value}${alpha}`)}
            className='size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5'
          />
          <Input
            aria-label={`${label} (hexadecimal)`}
            value={solid}
            maxLength={7}
            onChange={(event) => {
              const next = event.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(`${next}${alpha}`)
            }}
            className='font-mono'
          />
        </div>
      )}
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type='number'
          inputMode='decimal'
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (!Number.isFinite(next)) return
            onChange(
              Math.min(
                max ?? Number.POSITIVE_INFINITY,
                Math.max(min ?? Number.NEGATIVE_INFINITY, next),
              ),
            )
          }}
        />
      )}
    </Field>
  )
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={String(value)}
          onChange={(event) => {
            const picked = options.find(
              (option) => String(option.value) === event.target.value,
            )
            if (picked) onChange(picked.value)
          }}
          className='h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
        >
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  format?: (value: number) => string
}) {
  return (
    <Field label={label}>
      {(id) => (
        <div className='flex items-center gap-2'>
          <input
            id={id}
            type='range'
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className='h-9 min-w-0 flex-1 accent-primary'
          />
          <span className='w-12 text-right text-muted-foreground text-xs tabular-nums'>
            {format ? format(value) : value}
          </span>
        </div>
      )}
    </Field>
  )
}
