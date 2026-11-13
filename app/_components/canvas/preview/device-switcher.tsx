'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  ComputerIcon,
  SmartPhone01Icon,
  Tablet01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

export type PreviewDevice = 'base' | 'tablet' | 'mobile'

export const PREVIEW_DEVICES: Record<
  PreviewDevice,
  { label: string; icon: IconSvgElement; width: number | null }
> = {
  base: { label: 'Computador', icon: ComputerIcon, width: null },
  tablet: { label: 'Tablet', icon: Tablet01Icon, width: 768 },
  mobile: { label: 'Celular', icon: SmartPhone01Icon, width: 375 },
}

/**
 * Computador / Tablet / Celular segmented control shared by the editors'
 * top bar and the site, e-mail and document previews. `widths` adds the
 * real pixel width to each tooltip; `labels` renames a device (the editor
 * calls the first one "Desktop").
 */
export function DeviceSwitcher({
  value,
  onChange,
  devices = ['base', 'tablet', 'mobile'],
  widths,
  labels,
  className,
}: {
  value: PreviewDevice
  onChange: (device: PreviewDevice) => void
  devices?: readonly PreviewDevice[]
  widths?: Partial<Record<PreviewDevice, number | null>>
  labels?: Partial<Record<PreviewDevice, string>>
  className?: string
}) {
  return (
    <div
      role='toolbar'
      aria-label='Tamanho de tela'
      className={cn(
        'flex items-center gap-0.5 rounded-md bg-muted p-0.5',
        className,
      )}
    >
      {devices.map((device) => {
        const info = PREVIEW_DEVICES[device]
        const label = labels?.[device] ?? info.label
        const width = widths?.[device]
        return (
          <button
            key={device}
            type='button'
            aria-pressed={value === device}
            aria-label={label}
            title={width ? `${label} · ${width} px` : label}
            onClick={() => onChange(device)}
            className={cn(
              'flex h-7 w-8 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              value === device && 'bg-background text-foreground shadow-xs',
            )}
          >
            <SteelIcon icon={info.icon} className='size-4' />
          </button>
        )
      })}
    </div>
  )
}
