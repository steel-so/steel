'use client'

import { useEffect, useState } from 'react'
import { useGhostAiField } from '@/components/ui/ghost-ai'
import { cn } from '@/lib/utils'

type GhostTag = 'span' | 'h1' | 'h2' | 'h3' | 'p'

export type GhostInputProps = {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  as?: GhostTag
  className?: string
  maxLength?: number
  'aria-label'?: string
}

const GHOST_CLASS = cn(
  'w-full min-w-0 rounded-sm bg-transparent px-1 -mx-1 py-0.5 -my-0.5 outline-none transition-colors',
  'hover:bg-muted/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50',
  'placeholder:text-muted-foreground/50',
)

/**
 * Parece texto estático até o clique — vira um `<input>` editável em cima do
 * próprio texto renderizado, sem painel lateral. `readOnly` (usado no
 * preview público) desliga toda a interação e renderiza a tag semântica
 * (`as`) com o valor puro, sem nenhum affordance de edição.
 */
export function GhostInput({
  value,
  onCommit,
  placeholder,
  readOnly,
  as: Tag = 'span',
  className,
  maxLength,
  ...rest
}: GhostInputProps) {
  const [draft, setDraft] = useState(value)
  const aiRef = useGhostAiField(
    {
      getValue: () => draft,
      apply: (next) => {
        setDraft(next)
        if (next !== value) onCommit(next)
      },
      label: rest['aria-label'] ?? placeholder,
      multiline: false,
      maxLength,
    },
    readOnly,
  )

  useEffect(() => {
    setDraft(value)
  }, [value])

  if (readOnly) {
    if (!value) return null
    return <Tag className={className}>{value}</Tag>
  }

  return (
    <input
      ref={aiRef}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
      className={cn(GHOST_CLASS, className)}
      {...rest}
    />
  )
}
