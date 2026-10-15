'use client'

import { Switch } from '@/components/ui/switch'
import { backgroundToCss, type CanvasBackground } from '@/src/lib/canvas/values'
import { useCanvasEditor } from '../../editor-context'
import { ColorPicker } from './color'
import { ImagePicker } from './media'
import {
  type ControlProps,
  NumberInput,
  Segmented,
  SubField,
} from './primitives'

type Kind = CanvasBackground['kind']

const KIND_LABELS: Record<Kind, string> = {
  none: 'Nenhum',
  color: 'Cor',
  gradient: 'Gradiente',
  image: 'Imagem',
}

const POSITIONS = [
  { value: 'center', label: 'Centro' },
  { value: 'top', label: 'Topo' },
  { value: 'bottom', label: 'Base' },
  { value: 'left', label: 'Esquerda' },
  { value: 'right', label: 'Direita' },
] as const

const SIZES = [
  { value: 'cover', label: 'Cobrir' },
  { value: 'contain', label: 'Conter' },
  { value: 'auto', label: 'Original' },
] as const

/** Switching kinds keeps the color the user already picked. */
function convert(current: CanvasBackground, kind: Kind): CanvasBackground {
  const color =
    current.kind === 'color'
      ? current.color
      : current.kind === 'gradient'
        ? current.from
        : current.kind === 'image'
          ? current.color
          : undefined
  switch (kind) {
    case 'none':
      return { kind }
    case 'color':
      return { kind, color: color ?? '#F4F4F5' }
    case 'gradient':
      return { kind, angle: 135, from: color ?? '#6366F1', to: '#EC4899' }
    case 'image':
      return {
        kind,
        url: '',
        position: 'center',
        size: 'cover',
        repeat: false,
        ...(color ? { color } : {}),
      }
  }
}

export function BackgroundControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'background', CanvasBackground>) {
  const { props } = useCanvasEditor()
  const current: CanvasBackground = value ?? { kind: 'none' }
  const kinds: Kind[] = [
    'none',
    'color',
    ...(control.allowGradient !== false ? (['gradient'] as const) : []),
    ...(control.allowImage !== false ? (['image'] as const) : []),
  ]
  return (
    <div className='flex flex-col gap-2'>
      <Segmented
        id={id}
        label={`${label}: tipo`}
        value={current.kind}
        options={kinds.map((kind) => ({
          value: kind,
          label: KIND_LABELS[kind],
        }))}
        onChange={(kind) => onChange(convert(current, kind))}
      />
      {current.kind === 'color' && (
        <ColorPicker
          label={`${label}: cor`}
          value={current.color}
          allowEmpty={false}
          onChange={(color) =>
            onChange(color ? { kind: 'color', color } : { kind: 'none' })
          }
        />
      )}
      {current.kind === 'gradient' && (
        <>
          <div
            aria-hidden
            className='h-8 rounded-md ring-1 ring-foreground/10'
            style={backgroundToCss(current, props.colorTokens)}
          />
          <div className='grid grid-cols-2 gap-2'>
            <SubField label='Início'>
              <ColorPicker
                label={`${label}: cor inicial`}
                value={current.from}
                allowEmpty={false}
                onChange={(from) => from && onChange({ ...current, from })}
              />
            </SubField>
            <SubField label='Fim'>
              <ColorPicker
                label={`${label}: cor final`}
                value={current.to}
                allowEmpty={false}
                onChange={(to) => to && onChange({ ...current, to })}
              />
            </SubField>
          </div>
          <SubField label='Ângulo'>
            <div className='flex items-center gap-2'>
              <input
                type='range'
                aria-hidden
                tabIndex={-1}
                min={0}
                max={360}
                value={current.angle}
                onChange={(event) =>
                  onChange({ ...current, angle: Number(event.target.value) })
                }
                className='h-1 min-w-0 flex-1 cursor-pointer accent-primary'
              />
              <NumberInput
                label={`${label}: ângulo`}
                value={current.angle}
                min={0}
                max={360}
                unit='°'
                className='w-20 shrink-0'
                onChange={(angle) =>
                  onChange({ ...current, angle: angle ?? 0 })
                }
              />
            </div>
          </SubField>
        </>
      )}
      {current.kind === 'image' && (
        <>
          <ImagePicker
            label={`${label}: imagem`}
            src={current.url}
            onChange={(url) => onChange({ ...current, url })}
          />
          <div className='grid grid-cols-2 gap-2'>
            <SubField label='Posição'>
              <select
                aria-label={`${label}: posição`}
                value={current.position}
                onChange={(event) =>
                  onChange({
                    ...current,
                    position: event.target.value as typeof current.position,
                  })
                }
                className='h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
              >
                {POSITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </SubField>
            <SubField label='Tamanho'>
              <select
                aria-label={`${label}: tamanho`}
                value={current.size}
                onChange={(event) =>
                  onChange({
                    ...current,
                    size: event.target.value as typeof current.size,
                  })
                }
                className='h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
              >
                {SIZES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </SubField>
          </div>
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            Repetir imagem
            <Switch
              aria-label='Repetir imagem'
              size='sm'
              checked={current.repeat}
              onCheckedChange={(repeat) => onChange({ ...current, repeat })}
            />
          </div>
          <SubField label='Cor de fundo (se a imagem não carregar)'>
            <ColorPicker
              label={`${label}: cor reserva`}
              value={current.color}
              onChange={(color) => {
                const { color: _old, ...rest } = current
                onChange(color ? { ...rest, color } : rest)
              }}
            />
          </SubField>
        </>
      )}
    </div>
  )
}
