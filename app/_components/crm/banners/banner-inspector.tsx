'use client'

import { ImageAdd01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { FONT_LABELS } from '@/src/lib/banners/document'
import {
  BANNER_FONT_FAMILIES,
  BANNER_OBJECTIVE_LABELS,
  BANNER_OBJECTIVES,
  type BannerBackground,
  type BannerElement,
  type BannerFill,
  type BannerObjective,
} from '@/src/schemas/crm-banner.schema'
import {
  ColorField,
  Field,
  NumberField,
  RangeField,
  SelectField,
} from './banner-fields'

export type ElementPatch = Record<string, unknown>

const WEIGHTS = [
  { value: 400, label: 'Normal' },
  { value: 500, label: 'Médio' },
  { value: 700, label: 'Negrito' },
  { value: 800, label: 'Extra negrito' },
]

const FONT_OPTIONS = BANNER_FONT_FAMILIES.map((value) => ({
  value,
  label: FONT_LABELS[value],
}))

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='grid gap-3 border-b p-4 last:border-b-0'>
      <h3 className='font-medium text-xs uppercase tracking-wide text-muted-foreground'>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Solid color or two-color gradient, for shapes, buttons and the background. */
function FillEditor({
  label,
  fill,
  onChange,
}: {
  label: string
  fill: BannerFill
  onChange: (fill: BannerFill) => void
}) {
  return (
    <div className='grid gap-3'>
      <SelectField
        label={`${label}: tipo`}
        value={fill.kind}
        options={[
          { value: 'color', label: 'Cor sólida' },
          { value: 'gradient', label: 'Degradê' },
        ]}
        onChange={(kind) => {
          if (kind === fill.kind) return
          onChange(
            kind === 'color'
              ? {
                  kind: 'color',
                  color: fill.kind === 'gradient' ? fill.from : '#2563eb',
                }
              : {
                  kind: 'gradient',
                  from: fill.kind === 'color' ? fill.color : '#2563eb',
                  to: '#0f172a',
                  angle: 135,
                },
          )
        }}
      />
      {fill.kind === 'color' ? (
        <ColorField
          label={label}
          value={fill.color}
          onChange={(color) => onChange({ kind: 'color', color })}
        />
      ) : (
        <>
          <ColorField
            label='De'
            value={fill.from}
            onChange={(from) => onChange({ ...fill, from })}
          />
          <ColorField
            label='Para'
            value={fill.to}
            onChange={(to) => onChange({ ...fill, to })}
          />
          <RangeField
            label='Ângulo'
            value={fill.angle}
            min={0}
            max={360}
            step={5}
            format={(value) => `${value}°`}
            onChange={(angle) => onChange({ ...fill, angle })}
          />
        </>
      )}
    </div>
  )
}

function overlayAlpha(color: string): number {
  return color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1
}

function withAlpha(color: string, alpha: number): string {
  const hex = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${color.slice(0, 7)}${hex}`
}

export function BackgroundEditor({
  background,
  onChange,
  onPickImage,
}: {
  background: BannerBackground
  onChange: (background: BannerBackground) => void
  onPickImage: (apply: (url: string) => void) => void
}) {
  return (
    <div className='grid gap-3'>
      <SelectField
        label='Tipo de fundo'
        value={background.kind}
        options={[
          { value: 'color', label: 'Cor sólida' },
          { value: 'gradient', label: 'Degradê' },
          { value: 'image', label: 'Imagem' },
        ]}
        onChange={(kind) => {
          if (kind === background.kind) return
          if (kind === 'image') {
            onChange({
              kind: 'image',
              src: '',
              overlay: '#00000066',
              fallback:
                background.kind === 'color' ? background.color : '#0f172a',
            })
            onPickImage((src) =>
              onChange({
                kind: 'image',
                src,
                overlay: '#00000066',
                fallback: '#0f172a',
              }),
            )
          } else if (kind === 'color') {
            onChange({
              kind: 'color',
              color:
                background.kind === 'gradient' ? background.from : '#ffffff',
            })
          } else {
            onChange({
              kind: 'gradient',
              from: background.kind === 'color' ? background.color : '#2563eb',
              to: '#0f172a',
              angle: 135,
            })
          }
        }}
      />
      {background.kind === 'image' ? (
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() =>
              onPickImage((src) => onChange({ ...background, src }))
            }
          >
            <SteelIcon icon={ImageAdd01Icon} />
            {background.src ? 'Trocar imagem' : 'Escolher imagem'}
          </Button>
          <RangeField
            label='Véu escuro'
            value={overlayAlpha(background.overlay)}
            min={0}
            max={1}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(alpha) =>
              onChange({
                ...background,
                overlay: withAlpha('#000000', alpha),
              })
            }
          />
        </>
      ) : (
        <FillEditor
          label='Cor'
          fill={background}
          onChange={(fill) => onChange(fill)}
        />
      )}
    </div>
  )
}

/** Geometry shared by every element. */
function GeometryFields({
  element,
  onPatch,
}: {
  element: BannerElement
  onPatch: (patch: ElementPatch, key: string) => void
}) {
  return (
    <>
      <div className='grid grid-cols-2 gap-3'>
        <NumberField
          label='X'
          value={element.x}
          onChange={(x) => onPatch({ x }, 'x')}
        />
        <NumberField
          label='Y'
          value={element.y}
          onChange={(y) => onPatch({ y }, 'y')}
        />
        <NumberField
          label='Largura'
          value={element.w}
          min={1}
          onChange={(w) => onPatch({ w }, 'w')}
        />
        <NumberField
          label='Altura'
          value={element.h}
          min={1}
          onChange={(h) => onPatch({ h }, 'h')}
        />
        <NumberField
          label='Rotação'
          value={element.rotation}
          min={-360}
          max={360}
          onChange={(rotation) => onPatch({ rotation }, 'rotation')}
        />
      </div>
      <RangeField
        label='Opacidade'
        value={element.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(opacity) => onPatch({ opacity }, 'opacity')}
      />
    </>
  )
}

export function ElementInspector({
  element,
  onPatch,
  onPickImage,
}: {
  element: BannerElement
  onPatch: (patch: ElementPatch, key: string) => void
  onPickImage: (apply: (url: string) => void) => void
}) {
  return (
    <>
      {element.type === 'text' ? (
        <Section title='Texto'>
          <Field label='Conteúdo'>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={element.text}
                maxLength={500}
                onChange={(event) =>
                  onPatch({ text: event.target.value }, 'text')
                }
              />
            )}
          </Field>
          <SelectField
            label='Fonte'
            value={element.fontFamily}
            options={FONT_OPTIONS}
            onChange={(fontFamily) => onPatch({ fontFamily }, 'fontFamily')}
          />
          <div className='grid grid-cols-2 gap-3'>
            <NumberField
              label='Tamanho'
              value={element.fontSize}
              min={4}
              max={800}
              onChange={(fontSize) => onPatch({ fontSize }, 'fontSize')}
            />
            <SelectField
              label='Peso'
              value={element.fontWeight}
              options={WEIGHTS}
              onChange={(fontWeight) => onPatch({ fontWeight }, 'fontWeight')}
            />
            <NumberField
              label='Entrelinha'
              value={element.lineHeight}
              min={0.7}
              max={3}
              step={0.05}
              onChange={(lineHeight) => onPatch({ lineHeight }, 'lineHeight')}
            />
            <NumberField
              label='Espaçamento'
              value={element.letterSpacing}
              min={-10}
              max={50}
              step={0.5}
              onChange={(letterSpacing) =>
                onPatch({ letterSpacing }, 'letterSpacing')
              }
            />
          </div>
          <SelectField
            label='Alinhamento'
            value={element.align}
            options={[
              { value: 'left', label: 'Esquerda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Direita' },
            ]}
            onChange={(align) => onPatch({ align }, 'align')}
          />
          <ColorField
            label='Cor'
            value={element.color}
            onChange={(color) => onPatch({ color }, 'color')}
          />
          <Field label='Caixa alta'>
            {(id) => (
              <Switch
                id={id}
                checked={element.uppercase}
                onCheckedChange={(uppercase) =>
                  onPatch({ uppercase }, 'uppercase')
                }
              />
            )}
          </Field>
        </Section>
      ) : null}

      {element.type === 'button' ? (
        <Section title='Botão'>
          <Field label='Texto'>
            {(id) => (
              <Input
                id={id}
                value={element.text}
                maxLength={80}
                onChange={(event) =>
                  onPatch({ text: event.target.value }, 'text')
                }
              />
            )}
          </Field>
          <FillEditor
            label='Fundo'
            fill={element.background}
            onChange={(background) => onPatch({ background }, 'background')}
          />
          <ColorField
            label='Cor do texto'
            value={element.color}
            onChange={(color) => onPatch({ color }, 'color')}
          />
          <div className='grid grid-cols-2 gap-3'>
            <NumberField
              label='Tamanho'
              value={element.fontSize}
              min={4}
              max={400}
              onChange={(fontSize) => onPatch({ fontSize }, 'fontSize')}
            />
            <NumberField
              label='Arredondamento'
              value={element.radius}
              min={0}
              onChange={(radius) => onPatch({ radius }, 'radius')}
            />
          </div>
          <SelectField
            label='Fonte'
            value={element.fontFamily}
            options={FONT_OPTIONS}
            onChange={(fontFamily) => onPatch({ fontFamily }, 'fontFamily')}
          />
          <Field label='Caixa alta'>
            {(id) => (
              <Switch
                id={id}
                checked={element.uppercase}
                onCheckedChange={(uppercase) =>
                  onPatch({ uppercase }, 'uppercase')
                }
              />
            )}
          </Field>
        </Section>
      ) : null}

      {element.type === 'shape' ? (
        <Section title='Forma'>
          <SelectField
            label='Tipo'
            value={element.shape}
            options={[
              { value: 'rect', label: 'Retângulo' },
              { value: 'ellipse', label: 'Elipse' },
            ]}
            onChange={(shape) => onPatch({ shape }, 'shape')}
          />
          <FillEditor
            label='Preenchimento'
            fill={element.fill}
            onChange={(fill) => onPatch({ fill }, 'fill')}
          />
          <div className='grid grid-cols-2 gap-3'>
            <NumberField
              label='Arredondamento'
              value={element.radius}
              min={0}
              onChange={(radius) => onPatch({ radius }, 'radius')}
            />
            <NumberField
              label='Contorno'
              value={element.strokeWidth}
              min={0}
              max={100}
              onChange={(strokeWidth) =>
                onPatch({ strokeWidth }, 'strokeWidth')
              }
            />
          </div>
          <ColorField
            label='Cor do contorno'
            value={element.strokeColor}
            onChange={(strokeColor) => onPatch({ strokeColor }, 'strokeColor')}
          />
        </Section>
      ) : null}

      {element.type === 'image' || element.type === 'logo' ? (
        <Section title={element.type === 'logo' ? 'Logo' : 'Imagem'}>
          <Button
            type='button'
            variant='outline'
            onClick={() => onPickImage((src) => onPatch({ src }, 'src'))}
          >
            <SteelIcon icon={ImageAdd01Icon} />
            {element.src ? 'Trocar imagem' : 'Escolher imagem'}
          </Button>
          <SelectField
            label='Ajuste'
            value={element.fit}
            options={[
              { value: 'cover', label: 'Preencher (recorta)' },
              { value: 'contain', label: 'Caber inteira' },
            ]}
            onChange={(fit) => onPatch({ fit }, 'fit')}
          />
          <NumberField
            label='Arredondamento'
            value={element.radius}
            min={0}
            onChange={(radius) => onPatch({ radius }, 'radius')}
          />
          <Field label='Texto alternativo'>
            {(id) => (
              <Input
                id={id}
                value={element.alt}
                maxLength={200}
                onChange={(event) =>
                  onPatch({ alt: event.target.value }, 'alt')
                }
              />
            )}
          </Field>
        </Section>
      ) : null}

      <Section title='Posição e tamanho'>
        <GeometryFields element={element} onPatch={onPatch} />
      </Section>
    </>
  )
}

export interface BannerMeta {
  name: string
  folder: string
  tags: string[]
  objective: BannerObjective | null
}

export function BannerMetaFields({
  meta,
  folders,
  onChange,
}: {
  meta: BannerMeta
  folders: string[]
  onChange: (patch: Partial<BannerMeta>) => void
}) {
  return (
    <Section title='Banner'>
      <Field label='Nome'>
        {(id) => (
          <Input
            id={id}
            value={meta.name}
            maxLength={120}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </Field>
      <Field label='Pasta'>
        {(id) => (
          <>
            <Input
              id={id}
              value={meta.folder}
              maxLength={60}
              list={`${id}-folders`}
              placeholder='Sem pasta'
              onChange={(event) => onChange({ folder: event.target.value })}
            />
            <datalist id={`${id}-folders`}>
              {folders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label='Etiquetas (separadas por vírgula)'>
        {(id) => (
          <Input
            id={id}
            defaultValue={meta.tags.join(', ')}
            placeholder='verão, remarketing'
            onBlur={(event) =>
              onChange({
                tags: [
                  ...new Set(
                    event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ].slice(0, 10),
              })
            }
          />
        )}
      </Field>
      <SelectField
        label='Objetivo'
        value={meta.objective ?? ''}
        options={[
          { value: '', label: 'Sem objetivo' },
          ...BANNER_OBJECTIVES.map((value) => ({
            value,
            label: BANNER_OBJECTIVE_LABELS[value],
          })),
        ]}
        onChange={(value) =>
          onChange({
            objective: value === '' ? null : (value as BannerObjective),
          })
        }
      />
    </Section>
  )
}

export { Section as InspectorSection }
