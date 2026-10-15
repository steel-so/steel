'use client'

import { useId, useMemo } from 'react'
import { SiteSnapshot } from '@/app/_components/canvas-site/site-snapshot'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  box,
  button,
  heading,
  overline,
  row,
  section,
  text,
  toDocument,
  url,
} from '@/src/lib/canvas-site/presets/builder'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import {
  SITE_COLOR_IDS,
  SITE_COLOR_LABELS,
  SITE_FONTS,
  SITE_SPACE_STEPS,
  SITE_TEXT_PRESET_LABELS,
  SITE_TEXT_PRESETS,
  type SiteFontId,
  type SiteTextPreset,
  type SiteTheme,
} from '@/src/lib/canvas-site/theme'
import { useSiteEditor } from './site-editor-context'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const SPACE_LABELS: Record<(typeof SITE_SPACE_STEPS)[number], string> = {
  xs: 'Mínimo',
  sm: 'Pequeno',
  md: 'Médio',
  lg: 'Grande',
  xl: 'Extra',
  xxl: 'Máximo',
}

/** Sample page drawn with the theme being edited. */
export function themePreviewDocument() {
  return toDocument([
    section(
      { padding: { top: 40, right: 40, bottom: 40, left: 40 }, gap: 16 },
      [
        box({ gap: 16 }, [
          overline('Sobretítulo'),
          heading('h2', 'Um título que chama atenção'),
          text(
            'Texto do corpo com o tamanho, a altura de linha e as cores do tema. <a href="#">Um link</a> no meio do texto.',
          ),
          row([
            button('Primário', url('#'), { variant: 'primary' }),
            button('Secundário', url('#'), { variant: 'secondary' }),
            button('Contorno', url('#'), { variant: 'outline' }),
          ]),
        ]),
      ],
    ),
  ])
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className='grid gap-1'>
      <Label htmlFor={id} className='font-normal text-muted-foreground text-xs'>
        {label}
      </Label>
      <div className='relative'>
        <Input
          id={id}
          type='number'
          inputMode='decimal'
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (event.target.value !== '' && Number.isFinite(next)) {
              onChange(Math.min(max, Math.max(min, next)))
            }
          }}
          className={cn('h-8 text-xs', suffix && 'pr-8')}
        />
        {suffix ? (
          <span className='pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground'>
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
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
  return (
    <div className='flex items-center gap-2'>
      <input
        type='color'
        aria-label={`${label}: escolher cor`}
        value={value.length === 9 ? value.slice(0, 7) : value}
        onChange={(event) => onChange(event.target.value)}
        className='size-7 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5'
      />
      <Label
        htmlFor={id}
        className='min-w-0 flex-1 truncate font-normal text-xs'
      >
        {label}
      </Label>
      <Input
        id={id}
        defaultValue={value}
        key={value}
        maxLength={9}
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (HEX.test(next)) onChange(next.toLowerCase())
          else event.target.value = value
        }}
        className='h-7 w-24 font-mono text-[11px]'
      />
    </div>
  )
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: SiteFontId
  onChange: (value: SiteFontId) => void
}) {
  const id = useId()
  return (
    <div className='grid gap-1'>
      <Label htmlFor={id} className='font-normal text-muted-foreground text-xs'>
        {label}
      </Label>
      <Select
        value={value}
        onValueChange={(next) =>
          typeof next === 'string' && onChange(next as SiteFontId)
        }
      >
        <SelectTrigger id={id} size='sm' className='w-full text-xs'>
          <SelectValue>
            {(current: string | null) =>
              SITE_FONTS.find((font) => font.id === current)?.label ?? 'Fonte'
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {SITE_FONTS.map((font) => (
            <SelectItem key={font.id} value={font.id}>
              <span style={{ fontFamily: font.stack }}>{font.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Immutable update of one theme branch. */
function patch<K extends keyof SiteTheme>(
  theme: SiteTheme,
  key: K,
  value: Partial<SiteTheme[K]>,
): SiteTheme {
  const current = theme[key]
  return {
    ...theme,
    [key]:
      typeof current === 'object' && current !== null
        ? { ...current, ...value }
        : value,
  }
}

function TextStyleFields({
  preset,
  theme,
  onChange,
}: {
  preset: SiteTextPreset
  theme: SiteTheme
  onChange: (theme: SiteTheme) => void
}) {
  const style = theme.text[preset]
  const set = (value: Partial<typeof style>) =>
    onChange({
      ...theme,
      text: { ...theme.text, [preset]: { ...style, ...value } },
    })
  return (
    <div className='grid grid-cols-3 gap-2'>
      <NumberField
        label='Computador'
        suffix='px'
        min={8}
        max={200}
        value={style.size.base}
        onChange={(base) => set({ size: { ...style.size, base } })}
      />
      <NumberField
        label='Tablet'
        suffix='px'
        min={8}
        max={200}
        value={style.size.tablet ?? style.size.base}
        onChange={(tablet) => set({ size: { ...style.size, tablet } })}
      />
      <NumberField
        label='Celular'
        suffix='px'
        min={8}
        max={200}
        value={style.size.mobile ?? style.size.tablet ?? style.size.base}
        onChange={(mobile) => set({ size: { ...style.size, mobile } })}
      />
      <NumberField
        label='Peso'
        min={100}
        max={900}
        step={100}
        value={style.weight}
        onChange={(weight) => set({ weight })}
      />
      <NumberField
        label='Altura da linha'
        min={0.8}
        max={3}
        step={0.05}
        value={style.lineHeight}
        onChange={(lineHeight) => set({ lineHeight })}
      />
      <NumberField
        label='Espaçamento'
        suffix='px'
        min={-10}
        max={20}
        step={0.1}
        value={style.letterSpacing}
        onChange={(letterSpacing) => set({ letterSpacing })}
      />
    </div>
  )
}

const KIT_PRESETS = Object.values(SITE_KITS)

/**
 * "Tema": the site's design system — palette, fonts, text styles,
 * buttons, corners, spacing and content width — with a live preview. Every
 * page, header and footer reads it, so a change shows on the canvas at
 * once; it is saved automatically.
 */
export function ThemePanel() {
  const { theme, setTheme, canEdit } = useSiteEditor()
  const previewDocs = useMemo(() => [themePreviewDocument()], [])
  const update = (next: SiteTheme) => {
    if (canEdit) setTheme(next)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col' data-testid='theme-panel'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='p-3'>
          <SiteSnapshot
            docs={previewDocs}
            theme={theme}
            width={640}
            className='aspect-[2/1] rounded-lg border bg-white'
          />
        </div>
        <fieldset disabled={!canEdit} className='m-0 min-w-0 border-0 p-0'>
          <div className='grid gap-2 px-3 pb-3'>
            <p className='font-medium text-muted-foreground text-xs'>
              Estilos prontos
            </p>
            <div className='grid grid-cols-3 gap-1.5'>
              {KIT_PRESETS.map((kit) => (
                <button
                  key={kit.id}
                  type='button'
                  onClick={() => {
                    update(structuredClone(kit.theme))
                    notify.success(`Estilo “${kit.label}” aplicado.`)
                  }}
                  className='grid gap-1.5 rounded-md border p-1.5 text-left text-[11px] transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                >
                  <span className='flex h-4 overflow-hidden rounded-sm'>
                    {(['primary', 'secondary', 'accent', 'dark'] as const).map(
                      (color) => (
                        <span
                          key={color}
                          className='flex-1'
                          style={{ background: kit.theme.colors[color] }}
                        />
                      ),
                    )}
                  </span>
                  <span className='truncate'>{kit.label}</span>
                </button>
              ))}
            </div>
          </div>
          <Accordion
            multiple
            defaultValue={['colors']}
            className='border-t px-3'
          >
            <AccordionItem value='colors'>
              <AccordionTrigger className='text-xs'>Cores</AccordionTrigger>
              <AccordionContent className='grid gap-2'>
                {SITE_COLOR_IDS.map((id) => (
                  <ColorField
                    key={id}
                    label={SITE_COLOR_LABELS[id]}
                    value={theme.colors[id]}
                    onChange={(value) =>
                      update(patch(theme, 'colors', { [id]: value }))
                    }
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='fonts'>
              <AccordionTrigger className='text-xs'>Fontes</AccordionTrigger>
              <AccordionContent className='grid gap-2'>
                <FontSelect
                  label='Títulos'
                  value={theme.fonts.heading}
                  onChange={(heading) =>
                    update(patch(theme, 'fonts', { heading }))
                  }
                />
                <FontSelect
                  label='Textos'
                  value={theme.fonts.body}
                  onChange={(body) => update(patch(theme, 'fonts', { body }))}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='text'>
              <AccordionTrigger className='text-xs'>
                Estilos de texto
              </AccordionTrigger>
              <AccordionContent>
                <Accordion className='grid gap-1'>
                  {SITE_TEXT_PRESETS.map((preset) => (
                    <AccordionItem
                      key={preset}
                      value={preset}
                      className='rounded-md border px-2'
                    >
                      <AccordionTrigger className='py-2 text-xs'>
                        {SITE_TEXT_PRESET_LABELS[preset]}
                        <span className='ml-auto pr-2 font-normal text-muted-foreground'>
                          {theme.text[preset].size.base} px
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <TextStyleFields
                          preset={preset}
                          theme={theme}
                          onChange={update}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='buttons'>
              <AccordionTrigger className='text-xs'>Botões</AccordionTrigger>
              <AccordionContent className='grid grid-cols-2 gap-2'>
                <NumberField
                  label='Cantos'
                  suffix='px'
                  min={0}
                  max={999}
                  value={theme.buttons.radius}
                  onChange={(radius) =>
                    update(patch(theme, 'buttons', { radius }))
                  }
                />
                <NumberField
                  label='Tamanho do texto'
                  suffix='px'
                  min={10}
                  max={40}
                  value={theme.buttons.fontSize}
                  onChange={(fontSize) =>
                    update(patch(theme, 'buttons', { fontSize }))
                  }
                />
                <NumberField
                  label='Espaço lateral'
                  suffix='px'
                  min={0}
                  max={80}
                  value={theme.buttons.paddingX}
                  onChange={(paddingX) =>
                    update(patch(theme, 'buttons', { paddingX }))
                  }
                />
                <NumberField
                  label='Espaço vertical'
                  suffix='px'
                  min={0}
                  max={40}
                  value={theme.buttons.paddingY}
                  onChange={(paddingY) =>
                    update(patch(theme, 'buttons', { paddingY }))
                  }
                />
                <NumberField
                  label='Peso'
                  min={100}
                  max={900}
                  step={100}
                  value={theme.buttons.fontWeight}
                  onChange={(fontWeight) =>
                    update(patch(theme, 'buttons', { fontWeight }))
                  }
                />
                <NumberField
                  label='Borda'
                  suffix='px'
                  min={0}
                  max={8}
                  value={theme.buttons.borderWidth}
                  onChange={(borderWidth) =>
                    update(patch(theme, 'buttons', { borderWidth }))
                  }
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='shape'>
              <AccordionTrigger className='text-xs'>
                Cantos e largura
              </AccordionTrigger>
              <AccordionContent className='grid grid-cols-3 gap-2'>
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <NumberField
                    key={size}
                    label={{ sm: 'Pequeno', md: 'Médio', lg: 'Grande' }[size]}
                    suffix='px'
                    min={0}
                    max={999}
                    value={theme.radius[size]}
                    onChange={(value) =>
                      update(patch(theme, 'radius', { [size]: value }))
                    }
                  />
                ))}
                <div className='col-span-3'>
                  <NumberField
                    label='Largura máxima do conteúdo'
                    suffix='px'
                    min={480}
                    max={2400}
                    step={10}
                    value={theme.contentWidth}
                    onChange={(contentWidth) =>
                      update({ ...theme, contentWidth })
                    }
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='spacing'>
              <AccordionTrigger className='text-xs'>
                Espaçamento
              </AccordionTrigger>
              <AccordionContent className='grid grid-cols-3 gap-2'>
                {SITE_SPACE_STEPS.map((step) => (
                  <NumberField
                    key={step}
                    label={SPACE_LABELS[step]}
                    suffix='px'
                    min={0}
                    max={400}
                    value={theme.spacing[step]}
                    onChange={(value) =>
                      update(patch(theme, 'spacing', { [step]: value }))
                    }
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </fieldset>
      </div>
    </div>
  )
}
