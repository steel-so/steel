'use client'

import * as React from 'react'
import {
  durationUnitSeconds,
  formatAggregate,
} from '@/app/_components/crm/dashboard/widget-data'
import { cn } from '@/lib/utils'
import type { ChartConfig } from '@/src/schemas/crm-dashboard.schema'

type Step = { label: string; value: number }

const BASE = 100

/** Segment i: a flat run followed by a smooth curve to the next step's height. */
function segmentPath(i: number, n: number, values: number[], max: number) {
  const w = BASE / n
  const x0 = i * w
  const x1 = x0 + w
  const xm = x0 + w * 0.45
  const k = (x1 - xm) * 0.5
  const half = (v: number) => (v / max) * 48
  const a = half(values[i])
  const b = i === n - 1 ? a : half(values[i + 1])
  const top = 50 - a
  const topNext = 50 - b
  const bot = 50 + a
  const botNext = 50 + b
  return [
    `M${x0},${top}`,
    `L${xm},${top}`,
    `C${xm + k},${top} ${x1 - k},${topNext} ${x1},${topNext}`,
    `L${x1},${botNext}`,
    `C${x1 - k},${botNext} ${xm + k},${bot} ${xm},${bot}`,
    `L${x0},${bot}`,
    'Z',
  ].join(' ')
}

export function FunnelChart({
  steps: raw,
  config,
  palette,
  tv,
}: {
  steps: Step[]
  config: ChartConfig
  palette: string[]
  tv: boolean
}) {
  const [active, setActive] = React.useState(0)
  // Without an explicit sort the funnel runs from the largest to the smallest.
  const steps =
    config.xSort === 'none' && config.ySort === 'none'
      ? [...raw].sort((a, b) => b.value - a.value)
      : raw
  const n = steps.length
  const values = steps.map((s) => s.value)
  const max = Math.max(...values, 1)
  const first = values[0] || 0
  const color = palette[0]
  const fmt = (v: number) =>
    durationUnitSeconds(config) !== null
      ? formatAggregate(v, config)
      : `${config.prefix}${formatAggregate(v, config)}${config.suffix}`
  const pct = (a: number, b: number) =>
    b > 0 ? `${Math.round((a / b) * 100)}%` : '—'

  return (
    <div className={cn('flex h-full w-full flex-col gap-3', tv && 'gap-5')}>
      <div className='relative min-h-0 flex-1'>
        <svg
          viewBox='0 0 100 100'
          preserveAspectRatio='none'
          className='h-full w-full'
          role='img'
          aria-label='Funil'
        >
          {steps.map((s, i) => (
            <path
              key={s.label}
              d={segmentPath(i, n, values, max)}
              fill={color}
              fillOpacity={i === active ? 0.95 : 0.65 - i * (0.4 / n)}
              className='cursor-pointer transition-[fill-opacity]'
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </svg>
        {steps.slice(1).map((s, i) => (
          <div
            key={s.label}
            className={cn(
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
              'bg-background px-3 py-1 font-semibold text-foreground text-xs shadow-sm',
              tv && 'px-4 py-1.5 text-base',
            )}
            style={{ left: `${((i + 1) / n) * 100}%` }}
          >
            {pct(s.value, steps[i].value)}
          </div>
        ))}
      </div>

      <div
        className='grid gap-2'
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {steps.map((s, i) => (
          <button
            key={s.label}
            type='button'
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            className={cn(
              'min-w-0 rounded-xl p-3 text-left transition-colors',
              i === active ? 'bg-primary/10' : 'bg-muted/50',
            )}
          >
            <div className='flex items-center gap-1.5 text-muted-foreground text-xs'>
              <span
                className='size-2 shrink-0 rounded-full'
                style={{ background: color, opacity: 1 - i * (0.5 / n) }}
              />
              <span className='truncate'>{s.label}</span>
            </div>
            <div className={cn('font-semibold text-lg', tv && 'text-3xl')}>
              {fmt(s.value)}
            </div>
            <div className='truncate text-muted-foreground text-xs'>
              {i === 0 ? 'do total' : `${pct(s.value, first)} da 1ª etapa`}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
