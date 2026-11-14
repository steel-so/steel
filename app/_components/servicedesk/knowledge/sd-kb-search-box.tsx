'use client'

import { Cancel01Icon, Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

/** Campo de busca da KB com debounce (300 ms). */
export function SdKbSearchBox({
  value,
  onChange,
  placeholder = 'Buscar na base de conhecimento…',
  className,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 300)
    return () => clearTimeout(timer)
  }, [draft])

  return (
    <div
      data-tour='sd-kb-search'
      className={cn(
        'flex h-11 items-center gap-2 rounded-xl border bg-background px-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/40',
        className,
      )}
    >
      <SteelIcon
        icon={Search01Icon}
        strokeWidth={2}
        className='shrink-0 text-muted-foreground'
      />
      <input
        type='search'
        aria-label='Buscar artigos'
        value={draft}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(draft)
          if (e.key === 'Escape') {
            setDraft('')
            onChange('')
          }
        }}
        className='h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden'
      />
      {draft && (
        <button
          type='button'
          aria-label='Limpar busca'
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className='rounded p-0.5 text-muted-foreground hover:bg-muted'
        >
          <SteelIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
