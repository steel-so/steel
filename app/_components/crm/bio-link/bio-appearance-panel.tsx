'use client'

import { useEffect, useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  BIO_BACKGROUNDS,
  BIO_BUTTON_STYLES,
  BIO_FONTS,
  BIO_RADII,
  type BioThemeDTO,
} from '@/src/schemas/bio-link.schema'

const PRESETS: { id: string; label: string; theme: Partial<BioThemeDTO> }[] = [
  {
    id: 'claro',
    label: 'Claro',
    theme: {
      background: 'solid',
      backgroundColor: '#f4f4f5',
      textColor: '#18181b',
      buttonColor: '#18181b',
      buttonTextColor: '#ffffff',
    },
  },
  {
    id: 'escuro',
    label: 'Escuro',
    theme: {
      background: 'solid',
      backgroundColor: '#0f0f12',
      textColor: '#f4f4f5',
      buttonColor: '#f4f4f5',
      buttonTextColor: '#18181b',
    },
  },
  {
    id: 'oceano',
    label: 'Oceano',
    theme: {
      background: 'gradient',
      backgroundColor: '#0b3a6e',
      backgroundColor2: '#1296b0',
      textColor: '#ffffff',
      buttonColor: '#ffffff',
      buttonTextColor: '#0b3a6e',
    },
  },
  {
    id: 'por-do-sol',
    label: 'Pôr do sol',
    theme: {
      background: 'gradient',
      backgroundColor: '#ff7a59',
      backgroundColor2: '#ffb347',
      textColor: '#3a1500',
      buttonColor: '#3a1500',
      buttonTextColor: '#fff4e8',
    },
  },
  {
    id: 'floresta',
    label: 'Floresta',
    theme: {
      background: 'solid',
      backgroundColor: '#e8f1e4',
      textColor: '#173a1f',
      buttonColor: '#2f6b3a',
      buttonTextColor: '#ffffff',
    },
  },
  {
    id: 'rosa',
    label: 'Rosa',
    theme: {
      background: 'gradient',
      backgroundColor: '#ffe3ec',
      backgroundColor2: '#f9c6ff',
      textColor: '#4a1237',
      buttonColor: '#b3226b',
      buttonTextColor: '#ffffff',
    },
  },
]

const BACKGROUND_LABELS = { solid: 'Cor única', gradient: 'Degradê' } as const
const STYLE_LABELS = {
  solid: 'Preenchido',
  outline: 'Contorno',
  soft: 'Suave',
} as const
const RADIUS_LABELS = {
  none: 'Reto',
  sm: 'Leve',
  md: 'Médio',
  lg: 'Arredondado',
  full: 'Pílula',
} as const
const FONT_LABELS = {
  sans: 'Moderna',
  serif: 'Clássica',
  mono: 'Técnica',
  rounded: 'Suave',
} as const

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className='m-0 grid min-w-0 gap-1.5 border-0 p-0'>
      <legend className='mb-1.5 font-medium text-sm'>{label}</legend>
      <div className='flex flex-wrap gap-1.5'>
        {options.map((option) => (
          <button
            key={option.value}
            type='button'
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-9 rounded-lg border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              value === option.value
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={id} className='text-sm'>
        {label}
      </Label>
      <div className='flex items-center gap-2'>
        <input
          type='color'
          aria-label={`${label} (seletor)`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className='size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5'
        />
        <Input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          className='font-mono uppercase'
          aria-invalid={!/^#[0-9a-fA-F]{6}$/.test(text)}
          onChange={(event) => {
            const next = event.target.value.trim()
            setText(next)
            // Only complete colors reach the draft; typing "#1" waits.
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase())
          }}
        />
      </div>
    </div>
  )
}

/** Theme controls: ready-made palettes plus colors, button style, corner
 * radius and font. Everything shows live in the phone preview. */
export function BioAppearancePanel({
  theme,
  onChange,
}: {
  theme: BioThemeDTO
  onChange: (theme: BioThemeDTO) => void
}) {
  const set = <K extends keyof BioThemeDTO>(key: K, value: BioThemeDTO[K]) =>
    onChange({ ...theme, [key]: value })

  return (
    <div className='grid gap-6'>
      <section className='grid gap-2'>
        <h3 className='font-medium text-sm'>Paletas prontas</h3>
        <div className='grid grid-cols-3 gap-2 sm:grid-cols-6'>
          {PRESETS.map((preset) => {
            const merged = { ...theme, ...preset.theme }
            return (
              <button
                key={preset.id}
                type='button'
                onClick={() => onChange(merged)}
                aria-label={`Aplicar a paleta ${preset.label}`}
                className='group grid gap-1 rounded-lg border p-1.5 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <span
                  className='flex h-12 items-end justify-center rounded-md p-1.5'
                  style={{
                    background:
                      merged.background === 'gradient'
                        ? `linear-gradient(160deg, ${merged.backgroundColor}, ${merged.backgroundColor2})`
                        : merged.backgroundColor,
                  }}
                >
                  <span
                    className='h-3 w-full rounded-sm'
                    style={{ background: merged.buttonColor }}
                  />
                </span>
                {preset.label}
              </button>
            )
          })}
        </div>
      </section>

      <section className='grid gap-4'>
        <h3 className='font-medium text-sm'>Fundo</h3>
        <Segmented
          label='Tipo de fundo'
          value={theme.background}
          options={BIO_BACKGROUNDS.map((value) => ({
            value,
            label: BACKGROUND_LABELS[value],
          }))}
          onChange={(value) => set('background', value)}
        />
        <div className='grid gap-3 sm:grid-cols-2'>
          <ColorField
            label={
              theme.background === 'gradient' ? 'Cor inicial' : 'Cor do fundo'
            }
            value={theme.backgroundColor}
            onChange={(value) => set('backgroundColor', value)}
          />
          {theme.background === 'gradient' ? (
            <ColorField
              label='Cor final'
              value={theme.backgroundColor2}
              onChange={(value) => set('backgroundColor2', value)}
            />
          ) : null}
        </div>
      </section>

      <section className='grid gap-4'>
        <h3 className='font-medium text-sm'>Texto e botões</h3>
        <div className='grid gap-3 sm:grid-cols-3'>
          <ColorField
            label='Cor do texto'
            value={theme.textColor}
            onChange={(value) => set('textColor', value)}
          />
          <ColorField
            label='Cor dos botões'
            value={theme.buttonColor}
            onChange={(value) => set('buttonColor', value)}
          />
          <ColorField
            label='Texto dos botões'
            value={theme.buttonTextColor}
            onChange={(value) => set('buttonTextColor', value)}
          />
        </div>
        <Segmented
          label='Estilo do botão'
          value={theme.buttonStyle}
          options={BIO_BUTTON_STYLES.map((value) => ({
            value,
            label: STYLE_LABELS[value],
          }))}
          onChange={(value) => set('buttonStyle', value)}
        />
        <Segmented
          label='Cantos'
          value={theme.radius}
          options={BIO_RADII.map((value) => ({
            value,
            label: RADIUS_LABELS[value],
          }))}
          onChange={(value) => set('radius', value)}
        />
        <Segmented
          label='Fonte'
          value={theme.font}
          options={BIO_FONTS.map((value) => ({
            value,
            label: FONT_LABELS[value],
          }))}
          onChange={(value) => set('font', value)}
        />
      </section>
    </div>
  )
}
