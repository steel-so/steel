'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import type { InspectorControl } from '@/src/lib/canvas/registry'
import type { CanvasBreakpoint, CanvasNode } from '@/src/lib/canvas/types'

/** Props every inspector control receives. */
export interface ControlProps<
  K extends InspectorControl['kind'] = InspectorControl['kind'],
  V = unknown,
> {
  /** DOM id for the field label. */
  id: string
  label: string
  value: V | undefined
  onChange: (value: V | undefined) => void
  control: Extract<InspectorControl, { kind: K }>
  node: CanvasNode
  breakpoint: CanvasBreakpoint
}

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

function clamp(value: number, min?: number, max?: number) {
  let next = value
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined) next = Math.min(max, next)
  return next
}

function roundTo(value: number, step: number) {
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number(value.toFixed(Math.min(decimals, 4)))
}

/**
 * Compact number field: arrows step (Shift = ×10), the unit suffix is a
 * scrub handle (drag left/right), empty clears when `allowEmpty`.
 */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
  allowEmpty,
  label,
  className,
  icon,
}: {
  id?: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  placeholder?: string
  allowEmpty?: boolean
  label?: string
  className?: string
  icon?: ReactNode
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const focused = useRef(false)
  const scrub = useRef<{ x: number; start: number } | null>(null)

  useEffect(() => {
    if (!focused.current) setDraft(value === undefined ? '' : String(value))
  }, [value])

  const commit = (text: string) => {
    const trimmed = text.trim().replace(',', '.')
    if (trimmed === '') {
      if (allowEmpty) onChange(undefined)
      else setDraft(value === undefined ? '' : String(value))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(value === undefined ? '' : String(value))
      return
    }
    const next = roundTo(clamp(parsed, min, max), step)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  const nudge = (direction: 1 | -1, big: boolean) => {
    const base = value ?? min ?? 0
    const next = roundTo(
      clamp(base + direction * step * (big ? 10 : 1), min, max),
      step,
    )
    setDraft(String(next))
    onChange(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      nudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
    } else if (event.key === 'Enter') {
      commit(draft)
    } else if (event.key === 'Escape') {
      setDraft(value === undefined ? '' : String(value))
      ;(event.target as HTMLInputElement).blur()
    }
  }

  const onScrubDown = (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    scrub.current = { x: event.clientX, start: value ?? min ?? 0 }
  }
  const onScrubMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return
    const delta = Math.round((event.clientX - scrub.current.x) / 2)
    const next = roundTo(
      clamp(
        scrub.current.start + delta * step * (event.shiftKey ? 10 : 1),
        min,
        max,
      ),
      step,
    )
    if (next !== value) {
      setDraft(String(next))
      onChange(next)
    }
  }
  const onScrubUp = () => {
    scrub.current = null
  }

  return (
    <div
      className={cn(
        'group/number relative flex h-8 min-w-0 items-center rounded-md border border-input bg-background shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30',
        className,
      )}
    >
      {icon && (
        <span className='pointer-events-none flex shrink-0 items-center pl-2 text-muted-foreground'>
          {icon}
        </span>
      )}
      <input
        id={id}
        inputMode='decimal'
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onFocus={(event) => {
          focused.current = true
          event.target.select()
        }}
        onBlur={(event) => {
          focused.current = false
          commit(event.target.value)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        className='h-full w-full min-w-0 bg-transparent px-2 text-xs tabular-nums outline-none placeholder:text-muted-foreground'
      />
      {unit && (
        <span
          aria-hidden
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          title='Arraste para ajustar'
          className='flex h-full shrink-0 cursor-ew-resize items-center pr-2 pl-1 text-[10px] text-muted-foreground select-none hover:text-foreground'
        >
          {unit}
        </span>
      )}
    </div>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Shorter text shown in the button (the label stays the tooltip). */
  short?: string
  icon?: IconSvgElement
}

/** Segmented buttons (alignment, style…). Icons show the label as a
 * tooltip; text-only options show the label. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T | undefined
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  label: string
  id?: string
}) {
  return (
    <div
      id={id}
      role='toolbar'
      aria-label={label}
      className='flex h-8 w-full items-center gap-0.5 rounded-md bg-muted p-0.5'
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type='button'
            aria-pressed={checked}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              checked && 'bg-background text-foreground shadow-xs',
            )}
          >
            {option.icon ? (
              <SteelIcon icon={option.icon} className='size-4' />
            ) : (
              <span className='truncate'>{option.short ?? option.label}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Small label + control in one row (sub-fields of composite controls). */
export function SubField({
  label,
  children,
  htmlFor,
}: {
  label: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <label
        htmlFor={htmlFor}
        className='text-[11px] font-medium text-muted-foreground'
      >
        {label}
      </label>
      {children}
    </div>
  )
}
