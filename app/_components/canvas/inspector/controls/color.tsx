'use client'

import { Cancel01Icon } from '@hugeicons-pro/core-stroke-rounded'
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  type CanvasColorToken,
  isTokenColor,
  resolveColor,
  TOKEN_PREFIX,
} from '@/src/lib/canvas/values'
import { useCanvasEditor } from '../../editor-context'
import {
  type Hsva,
  hsvaToRgba,
  parseHex,
  pushRecentColor,
  readRecentColors,
  rgbaToHsva,
  toHex,
} from '../../lib/color'
import { type ControlProps, inputClass } from './primitives'

const CHECKER =
  'repeating-conic-gradient(#d4d4d8 0% 25%, #fff 0% 50%) 50% / 8px 8px'

/** Swatch preview of any stored color value. */
export function Swatch({
  color,
  tokens,
  className,
}: {
  color: string | undefined
  tokens?: readonly CanvasColorToken[]
  className?: string
}) {
  const css =
    color && color !== 'transparent' ? resolveColor(color, tokens) : undefined
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block size-5 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-foreground/15 ring-inset',
        className,
      )}
      style={{ background: CHECKER }}
    >
      {css && <span className='absolute inset-0' style={{ background: css }} />}
      {!color && (
        <span className='absolute inset-0 bg-background'>
          <span className='absolute top-1/2 left-1/2 h-px w-[140%] -translate-1/2 -rotate-45 bg-destructive/70' />
        </span>
      )}
    </span>
  )
}

/** Human label of a color value. */
export function colorLabel(
  color: string | undefined,
  tokens?: readonly CanvasColorToken[],
): string {
  if (!color) return 'Nenhuma'
  if (color === 'transparent') return 'Transparente'
  if (isTokenColor(color)) {
    const id = color.slice(TOKEN_PREFIX.length)
    return tokens?.find((token) => token.id === id)?.label ?? id
  }
  return color.toUpperCase()
}

function useDragArea(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
    onMove(x, y)
  }
  return {
    ref,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      move(event)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons === 1) move(event)
    },
  }
}

/** Saturation/value square + hue and alpha sliders. */
function HsvPicker({
  value,
  onChange,
}: {
  value: Hsva
  onChange: (value: Hsva) => void
}) {
  const square = useDragArea((x, y) => onChange({ ...value, s: x, v: 1 - y }))
  const hue = useDragArea((x) =>
    onChange({ ...value, h: Math.min(359.9, x * 360) }),
  )
  const alpha = useDragArea((x) =>
    onChange({ ...value, a: Math.round(x * 100) / 100 }),
  )
  const opaque = toHex({ ...hsvaToRgba(value), a: 1 })
  const keyStep = (
    event: React.KeyboardEvent,
    patch: (delta: number) => Partial<Hsva>,
  ) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0
    if (!delta) return
    event.preventDefault()
    onChange({ ...value, ...patch(delta * (event.shiftKey ? 10 : 1)) })
  }
  return (
    <div className='flex flex-col gap-2.5'>
      <div
        {...square}
        role='slider'
        tabIndex={0}
        aria-label='Saturação e brilho'
        aria-valuetext={`${Math.round(value.s * 100)}% de saturação, ${Math.round(value.v * 100)}% de brilho`}
        aria-valuenow={Math.round(value.s * 100)}
        onKeyDown={(event) =>
          keyStep(event, (d) =>
            event.key === 'ArrowUp' || event.key === 'ArrowDown'
              ? { v: Math.min(1, Math.max(0, value.v + d / 100)) }
              : { s: Math.min(1, Math.max(0, value.s + d / 100)) },
          )
        }
        className='relative h-36 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${value.h} 100% 50%))`,
        }}
      >
        <span
          className='pointer-events-none absolute size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]'
          style={{
            left: `${value.s * 100}%`,
            top: `${(1 - value.v) * 100}%`,
            background: opaque,
          }}
        />
      </div>
      <div
        {...hue}
        role='slider'
        tabIndex={0}
        aria-label='Matiz'
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(value.h)}
        onKeyDown={(event) =>
          keyStep(event, (d) => ({ h: (value.h + d + 360) % 360 }))
        }
        className='relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        style={{
          background:
            'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
      >
        <span
          className='pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]'
          style={{
            left: `${(value.h / 360) * 100}%`,
            background: `hsl(${value.h} 100% 50%)`,
          }}
        />
      </div>
      <div
        {...alpha}
        role='slider'
        tabIndex={0}
        aria-label='Opacidade'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value.a * 100)}
        onKeyDown={(event) =>
          keyStep(event, (d) => ({
            a: Math.min(1, Math.max(0, value.a + d / 100)),
          }))
        }
        className='relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        style={{ background: CHECKER }}
      >
        <span
          className='absolute inset-0 rounded-full'
          style={{
            background: `linear-gradient(to right, transparent, ${opaque})`,
          }}
        />
        <span
          className='pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]'
          style={{ left: `${value.a * 100}%`, background: opaque }}
        />
      </div>
    </div>
  )
}

function SwatchButton({
  color,
  label,
  selected,
  tokens,
  onClick,
}: {
  color: string
  label: string
  selected: boolean
  tokens?: readonly CanvasColorToken[]
  onClick: () => void
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'rounded-[6px] p-0.5 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        selected && 'ring-2 ring-primary',
      )}
    >
      <Swatch color={color} tokens={tokens} className='size-6' />
    </button>
  )
}

/**
 * Color field: swatch + value; the popover has an HSV picker with opacity,
 * a hex field, the theme tokens and the recently used colors.
 */
export function ColorPicker({
  id,
  label,
  value,
  onChange,
  allowTokens = true,
  allowTransparent = true,
  allowEmpty = true,
}: {
  id?: string
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  allowTokens?: boolean
  allowTransparent?: boolean
  allowEmpty?: boolean
}) {
  const { props } = useCanvasEditor()
  const tokens = allowTokens ? (props.colorTokens ?? []) : []
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const literal =
    value && !isTokenColor(value) && value !== 'transparent' ? value : null
  const resolved = value ? resolveColor(value, tokens) : undefined
  const [hsva, setHsva] = useState<Hsva>(() =>
    rgbaToHsva(
      parseHex(literal ?? resolved ?? '#000000') ?? { r: 0, g: 0, b: 0, a: 1 },
    ),
  )
  const [hex, setHex] = useState(literal ?? '')

  // Sync from outside (undo, other node) while keeping the hue of greys.
  useEffect(() => {
    const parsed = parseHex(
      literal ?? (resolved?.startsWith('#') ? resolved : '') ?? '',
    )
    if (parsed) {
      setHsva((prev) => {
        if (toHex(hsvaToRgba(prev)) === toHex(parsed)) return prev
        const next = rgbaToHsva(parsed)
        return next.s === 0 ? { ...next, h: prev.h } : next
      })
    }
    setHex(literal ?? '')
  }, [literal, resolved])

  useEffect(() => {
    if (open) setRecent(readRecentColors())
  }, [open])

  const pick = (next: string | undefined) => {
    onChange(next)
    if (next) setRecent(pushRecentColor(next))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && literal) setRecent(pushRecentColor(literal))
        setOpen(next)
      }}
    >
      <div className='relative flex min-w-0 items-center'>
        <PopoverTrigger
          id={id}
          aria-label={`${label}: ${colorLabel(value, tokens)}`}
          className={cn(
            inputClass,
            'flex items-center gap-2 pl-1.5 text-left',
            allowEmpty && value && 'pr-7',
          )}
        >
          <Swatch color={value} tokens={tokens} />
          <span className='min-w-0 flex-1 truncate font-mono text-[11px]'>
            {colorLabel(value, tokens)}
          </span>
        </PopoverTrigger>
        {allowEmpty && value && (
          <button
            type='button'
            aria-label={`Remover ${label}`}
            title='Remover cor'
            onClick={() => onChange(undefined)}
            className='absolute right-1.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
          >
            <SteelIcon icon={Cancel01Icon} className='size-3' />
          </button>
        )}
      </div>
      <PopoverContent
        align='end'
        side='left'
        sideOffset={8}
        className='w-64 gap-3 p-3'
      >
        <HsvPicker
          value={hsva}
          onChange={(next) => {
            setHsva(next)
            const nextHex = toHex(hsvaToRgba(next))
            setHex(nextHex)
            onChange(nextHex)
          }}
        />
        <div className='flex items-center gap-2'>
          <Swatch color={value} tokens={tokens} className='size-8' />
          <input
            aria-label='Código hexadecimal'
            value={hex}
            placeholder='#000000'
            onChange={(event) => setHex(event.target.value)}
            onBlur={() => {
              const parsed = parseHex(hex)
              if (parsed) pick(toHex(parsed))
              else setHex(literal ?? '')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const parsed = parseHex(hex)
                if (parsed) pick(toHex(parsed))
              }
            }}
            className={cn(inputClass, 'font-mono uppercase')}
          />
          <span className='w-10 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums'>
            {Math.round(hsva.a * 100)}%
          </span>
        </div>
        {tokens.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className='text-[11px] font-medium text-muted-foreground'>
              Cores do tema
            </span>
            <div className='flex flex-wrap gap-1'>
              {tokens.map((token) => (
                <SwatchButton
                  key={token.id}
                  color={`${TOKEN_PREFIX}${token.id}`}
                  label={token.label}
                  tokens={tokens}
                  selected={value === `${TOKEN_PREFIX}${token.id}`}
                  onClick={() => onChange(`${TOKEN_PREFIX}${token.id}`)}
                />
              ))}
            </div>
          </div>
        )}
        {(recent.length > 0 || allowTransparent) && (
          <div className='flex flex-col gap-1.5'>
            <span className='text-[11px] font-medium text-muted-foreground'>
              Recentes
            </span>
            <div className='flex flex-wrap gap-1'>
              {allowTransparent && (
                <SwatchButton
                  color='transparent'
                  label='Transparente'
                  selected={value === 'transparent'}
                  onClick={() => onChange('transparent')}
                />
              )}
              {recent.map((color) => (
                <SwatchButton
                  key={color}
                  color={color}
                  label={color}
                  selected={value === color}
                  onClick={() => pick(color)}
                />
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function ColorControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'color', string>) {
  return (
    <ColorPicker
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      allowTokens={control.allowTokens ?? true}
      allowTransparent={control.allowTransparent ?? true}
    />
  )
}
