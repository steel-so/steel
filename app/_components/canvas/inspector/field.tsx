'use client'

import {
  ComputerIcon,
  HelpCircleIcon,
  SmartPhone01Icon,
  Tablet01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ComponentType, useId } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import type {
  InspectorControl,
  InspectorField,
} from '@/src/lib/canvas/registry'
import type { CanvasBreakpoint, CanvasNode } from '@/src/lib/canvas/types'
import { BREAKPOINT_LABELS } from '../lib/messages'
import { BackgroundControl } from './controls/background'
import {
  NumberControl,
  SegmentedControl,
  SelectControl,
  TextareaControl,
  TextControl,
  ToggleControl,
} from './controls/basic'
import {
  BorderControl,
  RadiusControl,
  ShadowControl,
  SpacingControl,
} from './controls/box'
import { ColorControl } from './controls/color'
import { ListControl } from './controls/list'
import {
  ImageControl,
  LinkControl,
  SizeControl,
  VisibilityControl,
} from './controls/media'
import type { ControlProps } from './controls/primitives'
import { RichTextControl } from './controls/richtext'
import { TypographyControl } from './controls/typography'

type AnyControl = ComponentType<ControlProps<InspectorControl['kind'], unknown>>

const asControl = (component: unknown) => component as AnyControl

/** One component per control kind (`custom` comes from the catalog). */
export const CONTROLS: Record<
  Exclude<InspectorControl['kind'], 'custom'>,
  AnyControl
> = {
  text: asControl(TextControl),
  textarea: asControl(TextareaControl),
  richtext: asControl(RichTextControl),
  number: asControl(NumberControl),
  select: asControl(SelectControl),
  segmented: asControl(SegmentedControl),
  toggle: asControl(ToggleControl),
  color: asControl(ColorControl),
  spacing: asControl(SpacingControl),
  typography: asControl(TypographyControl),
  border: asControl(BorderControl),
  radius: asControl(RadiusControl),
  shadow: asControl(ShadowControl),
  background: asControl(BackgroundControl),
  image: asControl(ImageControl),
  link: asControl(LinkControl),
  size: asControl(SizeControl),
  visibility: asControl(VisibilityControl),
  list: asControl(ListControl),
}

const BP_ICONS = {
  base: ComputerIcon,
  tablet: Tablet01Icon,
  mobile: SmartPhone01Icon,
}

export interface FieldViewProps {
  field: InspectorField
  value: unknown
  onChange: (value: unknown) => void
  node: CanvasNode
  breakpoint: CanvasBreakpoint
  /** Responsive state at the active breakpoint (top-level fields only). */
  responsive?: {
    overridden: boolean
    inherited: boolean
    onClear: () => void
  }
}

/** Label row + control for one inspector field. */
export function FieldView({
  field,
  value,
  onChange,
  node,
  breakpoint,
  responsive,
}: FieldViewProps) {
  const id = useId()
  const { control } = field
  const inline = control.kind === 'toggle'
  const Control = control.kind === 'custom' ? null : CONTROLS[control.kind]

  const body =
    control.kind === 'custom' ? (
      <control.component
        value={value}
        onChange={onChange}
        node={node}
        breakpoint={breakpoint}
      />
    ) : Control ? (
      <Control
        id={id}
        label={field.label}
        value={value as never}
        onChange={onChange as never}
        control={control as never}
        node={node}
        breakpoint={breakpoint}
      />
    ) : null

  const badge = responsive && breakpoint !== 'base' && (
    <span className='ml-auto flex items-center gap-1'>
      {responsive.overridden ? (
        <>
          <span
            title={`Valor próprio em ${BREAKPOINT_LABELS[breakpoint]}`}
            className='inline-flex h-5 items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary'
          >
            <SteelIcon icon={BP_ICONS[breakpoint]} className='size-3' />
            {BREAKPOINT_LABELS[breakpoint]}
          </span>
          <button
            type='button'
            onClick={responsive.onClear}
            className='rounded px-1 text-[10px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
          >
            Limpar sobrescrita
          </button>
        </>
      ) : (
        <span
          title='Herdado do tamanho maior; editar cria um valor só para este tamanho'
          className='inline-flex h-5 items-center gap-1 rounded-full border border-dashed px-1.5 text-[10px] text-muted-foreground'
        >
          <SteelIcon icon={BP_ICONS[breakpoint]} className='size-3' />
          Herdado
        </span>
      )}
    </span>
  )

  return (
    <div
      data-field={field.path}
      className={cn(
        'flex flex-col gap-1.5',
        inline && 'flex-row items-center justify-between gap-3',
      )}
    >
      <div className='flex min-h-5 items-center gap-1'>
        <label htmlFor={id} className='text-xs font-medium text-foreground/80'>
          {field.label}
        </label>
        {field.help && (
          <span title={field.help} className='text-muted-foreground'>
            <SteelIcon icon={HelpCircleIcon} className='size-3.5' />
            <span className='sr-only'>{field.help}</span>
          </span>
        )}
        {!inline && badge}
      </div>
      {inline ? (
        <div className='flex items-center gap-2'>
          {badge}
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  )
}
