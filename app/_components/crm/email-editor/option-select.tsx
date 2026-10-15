'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }

/** Compact select of the e-mail editor's own controls. */
export function OptionSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Selecione',
  className,
}: {
  id?: string
  label: string
  value: string | null
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  )
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        size='sm'
        className={cn('w-full min-w-0 text-xs', className)}
      >
        <SelectValue placeholder={placeholder}>
          {(current: string | null) =>
            current ? (labels[current] ?? current) : placeholder
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
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
