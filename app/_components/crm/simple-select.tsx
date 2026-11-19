'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type SimpleSelectItem = { value: string; label: string }

/** Single-choice select over `{ value, label }` items (always has a value). */
export function SimpleSelect({
  value,
  onChange,
  items,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string
  onChange: (next: string) => void
  items: SimpleSelectItem[]
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange(next ?? value)}
    >
      <SelectTrigger aria-label={ariaLabel} className={className ?? 'w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
