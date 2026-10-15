'use client'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type PreviewContactOption,
  SAMPLE_KEY,
  TOKENS_KEY,
} from './use-preview-contacts'

/** "Ver como": sample contact, raw variables (optional) or a CRM person. */
export function ContactSelect({
  id,
  value,
  onChange,
  options,
  allowTokens = false,
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: PreviewContactOption[]
  allowTokens?: boolean
  className?: string
}) {
  const label =
    value === SAMPLE_KEY
      ? 'Contato de exemplo'
      : value === TOKENS_KEY
        ? 'Mostrar variáveis'
        : (options.find((option) => option.value === value)?.label ??
          'Contato de exemplo')
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger
        id={id}
        size='sm'
        aria-label='Ver como'
        className={className}
      >
        <SelectValue>
          <span className='truncate'>{label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SAMPLE_KEY}>Contato de exemplo</SelectItem>
        {allowTokens ? (
          <SelectItem value={TOKENS_KEY}>Mostrar variáveis</SelectItem>
        ) : null}
        {options.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Contatos do CRM</SelectLabel>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
      </SelectContent>
    </Select>
  )
}
