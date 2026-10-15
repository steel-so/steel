'use client'

import { useId } from 'react'
import { SpacingControl } from '@/app/_components/canvas/inspector/controls/box'
import { NumberInput } from '@/app/_components/canvas/inspector/controls/primitives'
import { Switch } from '@/components/ui/switch'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { CanvasSpacing, CanvasVisibility } from '@/src/lib/canvas/values'
import {
  desktopValue,
  mobileFontSize,
  mobilePadding,
  toggleDevice,
  withMobileFontSize,
  withMobileOverride,
} from '@/src/lib/canvas-email/mobile-overrides'

/**
 * "Celular" section of the e-mail inspector (E3): overrides that apply only
 * on phones, whatever breakpoint the canvas shows. They write the catalog's
 * responsive props (`{ base, mobile }`), which become media queries.
 */

function SwitchRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className='flex items-center justify-between gap-3'>
      <label htmlFor={id} className='text-xs text-foreground/80'>
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next)}
      />
    </div>
  )
}

/** Show on computer / phone (at least one stays on). */
export function DeviceVisibilityControl({
  value,
  onChange,
}: CustomControlProps) {
  const visibility = (value ?? {
    base: true,
    tablet: true,
    mobile: true,
  }) as CanvasVisibility
  return (
    <div className='flex flex-col gap-2' data-testid='mobile-visibility'>
      <SwitchRow
        label='Mostrar no computador'
        checked={visibility.base}
        disabled={visibility.base && !visibility.mobile}
        onChange={(shown) => onChange(toggleDevice(visibility, 'base', shown))}
      />
      <SwitchRow
        label='Mostrar no celular'
        checked={visibility.mobile}
        disabled={visibility.mobile && !visibility.base}
        onChange={(shown) =>
          onChange(toggleDevice(visibility, 'mobile', shown))
        }
      />
    </div>
  )
}

/** Own padding on phones (off = same as the computer). */
export function MobilePaddingControl({
  value,
  onChange,
  node,
  breakpoint,
}: CustomControlProps) {
  const id = useId()
  const override = mobilePadding(value)
  const desktop = desktopValue<CanvasSpacing>(value)
  return (
    <div className='flex flex-col gap-2' data-testid='mobile-padding'>
      <SwitchRow
        label='Margem própria no celular'
        checked={override !== undefined}
        onChange={(own) =>
          onChange(withMobileOverride(value, own ? desktop : undefined))
        }
      />
      {override ? (
        <SpacingControl
          id={id}
          label='Margem no celular'
          value={override}
          onChange={(next) => onChange(withMobileOverride(value, next))}
          control={{ kind: 'spacing', min: 0, max: 200 }}
          node={node}
          breakpoint={breakpoint}
        />
      ) : null}
    </div>
  )
}

/** Font size on phones (empty = same as the computer). */
export function MobileFontSizeControl({ value, onChange }: CustomControlProps) {
  const id = useId()
  return (
    <div className='flex items-center justify-between gap-3'>
      <label htmlFor={id} className='text-xs text-foreground/80'>
        Tamanho da fonte no celular
      </label>
      <NumberInput
        id={id}
        label='Tamanho da fonte no celular'
        value={mobileFontSize(value)}
        onChange={(size) => onChange(withMobileFontSize(value, size))}
        min={10}
        max={72}
        unit='px'
        placeholder='Igual'
        allowEmpty
        className='w-24 shrink-0'
      />
    </div>
  )
}
