'use client'

import { Link02Icon, Unlink02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  BORDER_STYLES,
  type CanvasBorder,
  type CanvasRadius,
  type CanvasShadow,
  type CanvasSpacing,
} from '@/src/lib/canvas/values'
import { ColorPicker } from './color'
import {
  type ControlProps,
  NumberInput,
  Segmented,
  SubField,
} from './primitives'

function LinkToggle({
  linked,
  onToggle,
  label,
}: {
  linked: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type='button'
      aria-pressed={linked}
      aria-label={
        linked
          ? `Editar ${label} por lado`
          : 'Usar o mesmo valor em todos os lados'
      }
      title={linked ? 'Valores separados' : 'Mesmo valor em todos'}
      onClick={onToggle}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        linked &&
          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      )}
    >
      <SteelIcon icon={linked ? Link02Icon : Unlink02Icon} className='size-4' />
    </button>
  )
}

const ZERO_SPACING: CanvasSpacing = { top: 0, right: 0, bottom: 0, left: 0 }

const SIDES = [
  ['top', 'Topo'],
  ['right', 'Direita'],
  ['bottom', 'Base'],
  ['left', 'Esquerda'],
] as const

/** Box model: one value for all sides when linked, else the four sides
 * laid out around a preview box. */
export function SpacingControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'spacing', CanvasSpacing>) {
  const current = value ?? ZERO_SPACING
  const uniform =
    current.top === current.right &&
    current.right === current.bottom &&
    current.bottom === current.left
  const [linked, setLinked] = useState(uniform)
  const min = control.min ?? 0
  const max = control.max ?? 400
  const set = (side: keyof CanvasSpacing, next: number | undefined) =>
    onChange({ ...current, [side]: next ?? 0 })

  if (linked) {
    return (
      <div className='flex items-center gap-2'>
        <NumberInput
          id={id}
          label={`${label} (todos os lados)`}
          value={current.top}
          min={min}
          max={max}
          unit='px'
          onChange={(next) =>
            onChange({
              top: next ?? 0,
              right: next ?? 0,
              bottom: next ?? 0,
              left: next ?? 0,
            })
          }
        />
        <LinkToggle linked label={label} onToggle={() => setLinked(false)} />
      </div>
    )
  }
  return (
    <div className='flex items-start gap-2'>
      <div className='grid flex-1 grid-cols-[1fr_1.1fr_1fr] grid-rows-3 items-center gap-1 rounded-lg border border-dashed bg-muted/40 p-1.5'>
        {SIDES.map(([side, sideLabel]) => (
          <div
            key={side}
            className={cn(
              side === 'top' && 'col-start-2 row-start-1',
              side === 'right' && 'col-start-3 row-start-2',
              side === 'bottom' && 'col-start-2 row-start-3',
              side === 'left' && 'col-start-1 row-start-2',
            )}
          >
            <NumberInput
              id={side === 'top' ? id : undefined}
              label={`${label}: ${sideLabel}`}
              value={current[side]}
              min={min}
              max={max}
              onChange={(next) => set(side, next)}
              className='h-7'
            />
          </div>
        ))}
        <div className='col-start-2 row-start-2 mx-auto h-5 w-full rounded-[4px] border bg-background' />
      </div>
      <LinkToggle
        linked={false}
        label={label}
        onToggle={() => setLinked(true)}
      />
    </div>
  )
}

const ZERO_RADIUS: CanvasRadius = {
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
}

const CORNERS = [
  ['topLeft', 'Superior esquerdo'],
  ['topRight', 'Superior direito'],
  ['bottomLeft', 'Inferior esquerdo'],
  ['bottomRight', 'Inferior direito'],
] as const

export function RadiusControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'radius', CanvasRadius>) {
  const current = value ?? ZERO_RADIUS
  const values = Object.values(current)
  const [linked, setLinked] = useState(values.every((v) => v === values[0]))
  if (linked) {
    return (
      <div className='flex items-center gap-2'>
        <div className='flex flex-1 items-center gap-2'>
          <input
            type='range'
            aria-hidden
            tabIndex={-1}
            min={0}
            max={64}
            value={current.topLeft}
            onChange={(event) => {
              const n = Number(event.target.value)
              onChange({
                topLeft: n,
                topRight: n,
                bottomRight: n,
                bottomLeft: n,
              })
            }}
            className='h-1 min-w-0 flex-1 cursor-pointer accent-primary'
          />
          <NumberInput
            id={id}
            label={label}
            value={current.topLeft}
            min={0}
            max={999}
            unit='px'
            className='w-20 shrink-0'
            onChange={(n) =>
              onChange({
                topLeft: n ?? 0,
                topRight: n ?? 0,
                bottomRight: n ?? 0,
                bottomLeft: n ?? 0,
              })
            }
          />
        </div>
        <LinkToggle linked label={label} onToggle={() => setLinked(false)} />
      </div>
    )
  }
  return (
    <div className='flex items-start gap-2'>
      <div className='grid flex-1 grid-cols-2 gap-1.5'>
        {CORNERS.map(([corner, cornerLabel]) => (
          <NumberInput
            key={corner}
            id={corner === 'topLeft' ? id : undefined}
            label={`${label}: ${cornerLabel}`}
            value={current[corner]}
            min={0}
            max={999}
            unit='px'
            icon={
              <span
                aria-hidden
                className={cn(
                  'block size-2.5 border-current',
                  corner === 'topLeft' &&
                    'rounded-tl-[4px] border-t-2 border-l-2',
                  corner === 'topRight' &&
                    'rounded-tr-[4px] border-t-2 border-r-2',
                  corner === 'bottomLeft' &&
                    'rounded-bl-[4px] border-b-2 border-l-2',
                  corner === 'bottomRight' &&
                    'rounded-br-[4px] border-r-2 border-b-2',
                )}
              />
            }
            onChange={(n) => onChange({ ...current, [corner]: n ?? 0 })}
          />
        ))}
      </div>
      <LinkToggle
        linked={false}
        label={label}
        onToggle={() => setLinked(true)}
      />
    </div>
  )
}

const BORDER_LABELS: Record<(typeof BORDER_STYLES)[number], string> = {
  none: 'Nenhuma',
  solid: 'Sólida',
  dashed: 'Tracejada',
  dotted: 'Pontilhada',
}

const DEFAULT_BORDER: CanvasBorder = {
  width: 1,
  style: 'solid',
  color: '#E4E4E7',
}

export function BorderControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'border', CanvasBorder>) {
  const current = value ?? { ...DEFAULT_BORDER, style: 'none' as const }
  const active = current.style !== 'none'
  return (
    <div className='flex flex-col gap-2'>
      <Segmented
        id={id}
        label={`${label}: estilo`}
        value={current.style}
        options={BORDER_STYLES.map((style) => ({
          value: style,
          label: BORDER_LABELS[style],
        }))}
        onChange={(style) =>
          onChange(
            style === 'none'
              ? { ...current, style }
              : { ...current, style, width: current.width || 1 },
          )
        }
      />
      {active && (
        <div className='grid grid-cols-[5.5rem_1fr] gap-2'>
          <SubField label='Espessura'>
            <NumberInput
              label={`${label}: espessura`}
              value={current.width}
              min={0}
              max={50}
              unit='px'
              onChange={(width) => onChange({ ...current, width: width ?? 0 })}
            />
          </SubField>
          <SubField label='Cor'>
            <ColorPicker
              label={`${label}: cor`}
              value={current.color}
              allowEmpty={false}
              onChange={(color) =>
                onChange({ ...current, color: color ?? DEFAULT_BORDER.color })
              }
            />
          </SubField>
        </div>
      )}
    </div>
  )
}

export const SHADOW_PRESETS: Array<{ label: string; value: CanvasShadow }> = [
  { label: 'Nenhuma', value: null },
  {
    label: 'Suave',
    value: { x: 0, y: 1, blur: 3, spread: 0, color: '#0000001A' },
  },
  {
    label: 'Média',
    value: { x: 0, y: 4, blur: 12, spread: -2, color: '#00000026' },
  },
  {
    label: 'Forte',
    value: { x: 0, y: 12, blur: 32, spread: -8, color: '#00000040' },
  },
]

export function ShadowControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'shadow', CanvasShadow>) {
  const current = value ?? null
  const presetIndex = SHADOW_PRESETS.findIndex(
    (preset) => JSON.stringify(preset.value) === JSON.stringify(current),
  )
  const [custom, setCustom] = useState(presetIndex === -1 && current !== null)
  return (
    <div className='flex flex-col gap-2'>
      <Segmented
        id={id}
        label={`${label}: predefinição`}
        value={custom ? 'custom' : String(Math.max(presetIndex, 0))}
        options={[
          ...SHADOW_PRESETS.map((preset, index) => ({
            value: String(index),
            label: preset.label,
          })),
          { value: 'custom', label: 'Ajustar' },
        ]}
        onChange={(next) => {
          if (next === 'custom') {
            setCustom(true)
            if (!current) onChange(SHADOW_PRESETS[2].value)
            return
          }
          setCustom(false)
          onChange(SHADOW_PRESETS[Number(next)].value)
        }}
      />
      {custom && current && (
        <div className='grid grid-cols-2 gap-1.5'>
          {(
            [
              ['x', 'Horizontal', -200, 200],
              ['y', 'Vertical', -200, 200],
              ['blur', 'Desfoque', 0, 400],
              ['spread', 'Expansão', -200, 200],
            ] as const
          ).map(([key, keyLabel, min, max]) => (
            <SubField key={key} label={keyLabel}>
              <NumberInput
                label={`${label}: ${keyLabel}`}
                value={current[key]}
                min={min}
                max={max}
                unit='px'
                onChange={(n) => onChange({ ...current, [key]: n ?? 0 })}
              />
            </SubField>
          ))}
          <div className='col-span-2'>
            <SubField label='Cor'>
              <ColorPicker
                label={`${label}: cor`}
                value={current.color}
                allowEmpty={false}
                onChange={(color) =>
                  onChange({ ...current, color: color ?? '#00000026' })
                }
              />
            </SubField>
          </div>
          <div className='col-span-2 flex items-center justify-between text-xs text-muted-foreground'>
            Sombra interna
            <Switch
              aria-label='Sombra interna'
              size='sm'
              checked={!!current.inset}
              onCheckedChange={(inset) =>
                onChange({ ...current, inset: inset || undefined })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
