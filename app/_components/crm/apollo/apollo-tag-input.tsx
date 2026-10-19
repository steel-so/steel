'use client'

import { Cancel01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

/** Free-text multi-value field: Enter or comma adds a chip, × removes it. */
export function ApolloTagInput({
  id,
  value,
  onChange,
  placeholder,
  max = 30,
}: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  max?: number
}) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 0) return
    const next = [...value]
    for (const part of parts) {
      if (next.length >= max) break
      if (!next.some((item) => item.toLowerCase() === part.toLowerCase())) {
        next.push(part)
      }
    }
    onChange(next)
    setDraft('')
  }

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value
          if (text.includes(',')) commit(text)
          else setDraft(text)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
          } else if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
      />
      {value.length > 0 ? (
        <ul className='flex min-w-0 flex-wrap gap-1.5'>
          {value.map((item) => (
            <li key={item} className='min-w-0'>
              <Badge variant='secondary' className='max-w-full gap-1'>
                <span className='truncate'>{item}</span>
                <button
                  type='button'
                  aria-label={`Remover ${item}`}
                  className='rounded-sm opacity-70 hover:opacity-100'
                  onClick={() => onChange(value.filter((v) => v !== item))}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
