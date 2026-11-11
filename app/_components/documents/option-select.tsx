'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface DocumentOption {
  value: string
  label: string
}

/** Value of the "all"/"none" entry (Base UI selects need a string). */
export const ANY_OPTION = '__any__'

/**
 * A labelled select of plain options, with an optional first entry that
 * means "no value" (`emptyLabel`: "Todos", "Nenhuma"…), reported as `''`.
 */
export function OptionSelect({
  id,
  value,
  options,
  onChange,
  emptyLabel,
  ariaLabel,
  disabled,
  size = 'default',
  className,
}: {
  id?: string
  value: string
  options: DocumentOption[]
  onChange: (value: string) => void
  emptyLabel?: string
  ariaLabel?: string
  disabled?: boolean
  size?: 'sm' | 'default'
  className?: string
}) {
  const current = value === '' && emptyLabel ? ANY_OPTION : value
  const label =
    current === ANY_OPTION
      ? emptyLabel
      : (options.find((option) => option.value === current)?.label ?? '')
  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next !== 'string') return
        onChange(next === ANY_OPTION ? '' : next)
      }}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn('w-full min-w-0', className)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {emptyLabel ? (
          <SelectItem value={ANY_OPTION}>{emptyLabel}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
