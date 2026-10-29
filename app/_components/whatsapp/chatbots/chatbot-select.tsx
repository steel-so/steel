'use client'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface SimpleOption {
  value: string
  label: string
}

/** Thin wrapper over the Base UI select for plain value/label lists. */
export function SimpleSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
}: {
  value: string
  options: SimpleOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger className='w-full' aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder}>
          {options.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
