'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useGhostAiField } from '@/components/ui/ghost-ai'
import { cn } from '@/lib/utils'

export type GhostTextareaProps = {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  as?: 'p' | 'span'
  className?: string
  maxLength?: number
  'aria-label'?: string
}

const GHOST_CLASS = cn(
  'w-full min-w-0 resize-none overflow-hidden rounded-sm bg-transparent px-1 -mx-1 py-0.5 -my-0.5 outline-none transition-colors',
  'hover:bg-muted/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50',
  'placeholder:text-muted-foreground/50',
)

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/**
 * Variante multi-linha do GhostInput — comita só no blur (Enter quebra
 * linha normalmente), com autosize pra acompanhar o texto.
 */
export function GhostTextarea({
  value,
  onCommit,
  placeholder,
  readOnly,
  as: Tag = 'p',
  className,
  maxLength,
  ...rest
}: GhostTextareaProps) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const aiRef = useGhostAiField(
    {
      getValue: () => draft,
      apply: (next) => {
        setDraft(next)
        if (next !== value) onCommit(next)
      },
      label: rest['aria-label'] ?? placeholder,
      multiline: true,
      maxLength,
    },
    readOnly,
  )
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el
      aiRef(el)
    },
    [aiRef],
  )

  useEffect(() => {
    setDraft(value)
    // Re-measure when the value changes from outside (e.g. an AI suggestion).
    requestAnimationFrame(() => autosize(ref.current))
  }, [value])

  useEffect(() => {
    autosize(ref.current)
  }, [])

  if (readOnly) {
    if (!value) return null
    return <Tag className={className}>{value}</Tag>
  }

  return (
    <textarea
      ref={setRefs}
      rows={1}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => {
        setDraft(e.target.value)
        autosize(e.target)
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
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
