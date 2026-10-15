'use client'

import { TextItalicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { CanvasTypography } from '@/src/lib/canvas/values'
import { useCanvasEditor } from '../../editor-context'
import {
  type ControlProps,
  NumberInput,
  Segmented,
  SubField,
} from './primitives'

/** Web-safe defaults (each with fallbacks) when the editor gets no list. */
export const DEFAULT_FONTS = [
  { label: 'Padrão do tema', value: '' },
  { label: 'Inter', value: 'Inter, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
]

const WEIGHTS = [
  { value: '300', label: 'Leve' },
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Médio' },
  { value: '600', label: 'Seminegrito' },
  { value: '700', label: 'Negrito' },
  { value: '800', label: 'Extranegrito' },
]

const TRANSFORMS = [
  { value: 'none', label: 'Sem transformação', short: '—' },
  { value: 'uppercase', label: 'MAIÚSCULAS', short: 'AA' },
  { value: 'lowercase', label: 'minúsculas', short: 'aa' },
  { value: 'capitalize', label: 'Iniciais Maiúsculas', short: 'Aa' },
] as const

/** Font family, size, weight, line height, letter spacing, case, italic.
 * Empty sub-values inherit from the theme/parent. */
export function TypographyControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'typography', CanvasTypography>) {
  const { props } = useCanvasEditor()
  const fonts = props.fonts?.length
    ? [{ label: 'Padrão do tema', value: '' }, ...props.fonts]
    : DEFAULT_FONTS
  const current = value ?? {}
  const set = <K extends keyof CanvasTypography>(
    key: K,
    next: CanvasTypography[K] | undefined,
  ) => {
    const copy: CanvasTypography = { ...current }
    if (next === undefined || next === '') delete copy[key]
    else copy[key] = next
    onChange(copy)
  }
  const fontLabel = (family: string | null) =>
    fonts.find((font) => font.value === (family ?? ''))?.label ??
    family ??
    'Padrão do tema'

  return (
    <div className='flex flex-col gap-2'>
      <SubField label='Fonte' htmlFor={id}>
        <Select
          value={current.fontFamily ?? ''}
          onValueChange={(next) =>
            set('fontFamily', typeof next === 'string' ? next : undefined)
          }
        >
          <SelectTrigger
            id={id}
            aria-label={`${label}: fonte`}
            size='sm'
            className='w-full text-xs'
          >
            <SelectValue>
              {(family: string | null) => fontLabel(family)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {fonts.map((font) => (
              <SelectItem
                key={font.label}
                value={font.value}
                className='text-xs'
              >
                <span style={{ fontFamily: font.value || undefined }}>
                  {font.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SubField>
      <div className='grid grid-cols-2 gap-2'>
        <SubField label='Tamanho'>
          <NumberInput
            label={`${label}: tamanho`}
            value={current.fontSize}
            min={6}
            max={400}
            unit='px'
            allowEmpty
            placeholder='Auto'
            onChange={(next) => set('fontSize', next)}
          />
        </SubField>
        <SubField label='Peso'>
          <Select
            value={current.fontWeight ? String(current.fontWeight) : ''}
            onValueChange={(next) =>
              set(
                'fontWeight',
                typeof next === 'string' && next ? Number(next) : undefined,
              )
            }
          >
            <SelectTrigger
              aria-label={`${label}: peso`}
              size='sm'
              className='w-full text-xs'
            >
              <SelectValue>
                {(weight: string | null) =>
                  WEIGHTS.find((item) => item.value === weight)?.label ?? 'Auto'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value='' className='text-xs'>
                Auto
              </SelectItem>
              {WEIGHTS.map((weight) => (
                <SelectItem
                  key={weight.value}
                  value={weight.value}
                  className='text-xs'
                >
                  <span style={{ fontWeight: Number(weight.value) }}>
                    {weight.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SubField>
        <SubField label='Altura da linha'>
          <NumberInput
            label={`${label}: altura da linha`}
            value={current.lineHeight}
            min={0.5}
            max={5}
            step={0.1}
            unit='×'
            allowEmpty
            placeholder='Auto'
            onChange={(next) => set('lineHeight', next)}
          />
        </SubField>
        <SubField label='Espaçamento'>
          <NumberInput
            label={`${label}: espaçamento entre letras`}
            value={current.letterSpacing}
            min={-20}
            max={100}
            step={0.1}
            unit='px'
            allowEmpty
            placeholder='0'
            onChange={(next) => set('letterSpacing', next)}
          />
        </SubField>
      </div>
      <div className='flex items-center gap-2'>
        <div className='min-w-0 flex-1'>
          <Segmented
            label={`${label}: maiúsculas e minúsculas`}
            value={current.textTransform ?? 'none'}
            options={TRANSFORMS.map((item) => ({
              value: item.value,
              label: item.label,
              short: item.short,
            }))}
            onChange={(next) =>
              set('textTransform', next === 'none' ? undefined : next)
            }
          />
        </div>
        <button
          type='button'
          aria-pressed={!!current.italic}
          aria-label='Itálico'
          title='Itálico'
          onClick={() => set('italic', current.italic ? undefined : true)}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            current.italic && 'border-primary/40 bg-primary/10 text-primary',
          )}
        >
          <SteelIcon icon={TextItalicIcon} className='size-4' />
        </button>
      </div>
    </div>
  )
}
