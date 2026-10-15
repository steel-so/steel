'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  Call02Icon,
  ComputerIcon,
  Delete02Icon,
  File01Icon,
  Globe02Icon,
  HashtagIcon,
  Image02Icon,
  Loading03Icon,
  Mail01Icon,
  SmartPhone01Icon,
  Tablet01Icon,
  Upload01Icon,
  WebDesign01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type DragEvent, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { CANVAS_BREAKPOINTS } from '@/src/lib/canvas/types'
import {
  type CanvasImage,
  type CanvasLink,
  type CanvasLinkTarget,
  type CanvasSize,
  type CanvasSizeUnit,
  type CanvasVisibility,
  LINK_TARGETS,
  SIZE_UNITS,
  VISIBLE_EVERYWHERE,
} from '@/src/lib/canvas/values'
import { useCanvasEditor } from '../../editor-context'
import { BREAKPOINT_LABELS } from '../../lib/messages'
import {
  type ControlProps,
  inputClass,
  NumberInput,
  SubField,
} from './primitives'

/**
 * Image source picker: preview, upload (button or drop a file — only with
 * `onUploadImage`) and a URL field.
 */
export function ImagePicker({
  id,
  label,
  src,
  onChange,
  accept,
}: {
  id?: string
  label: string
  src: string
  onChange: (src: string) => void
  accept?: string[]
}) {
  const { props } = useCanvasEditor()
  const upload = props.onUploadImage
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  const send = async (file: File | undefined) => {
    if (!file || !upload) return
    setBusy(true)
    try {
      const url = await upload(file)
      if (url) onChange(url)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    void send(event.dataTransfer.files?.[0])
  }

  return (
    <div className='flex flex-col gap-2'>
      <div
        onDragOver={(event) => {
          if (!upload) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px] transition-colors',
          over && 'border-primary ring-2 ring-primary/30',
        )}
      >
        {src ? (
          <img src={src} alt='' className='size-full object-contain' />
        ) : (
          <div className='flex flex-col items-center gap-1.5 text-center text-[11px] text-muted-foreground'>
            <SteelIcon icon={Image02Icon} className='size-6' />
            {upload
              ? 'Arraste uma imagem ou envie'
              : 'Informe o endereço da imagem'}
          </div>
        )}
        {busy && (
          <div className='absolute inset-0 flex items-center justify-center bg-background/70 text-xs font-medium'>
            <SteelIcon
              icon={Loading03Icon}
              className='mr-1.5 size-4 animate-spin'
            />
            Enviando…
          </div>
        )}
        {src && !busy && (
          <button
            type='button'
            aria-label={`Remover ${label}`}
            title='Remover imagem'
            onClick={() => onChange('')}
            className='absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100'
          >
            <SteelIcon icon={Delete02Icon} className='size-3.5' />
          </button>
        )}
      </div>
      {upload && (
        <>
          <input
            ref={fileRef}
            type='file'
            accept={(accept ?? ['image/*']).join(',')}
            className='hidden'
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              void send(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <button
            type='button'
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className='inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background text-xs font-medium shadow-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50'
          >
            <SteelIcon icon={Upload01Icon} className='size-3.5' />
            {src ? 'Trocar imagem' : 'Enviar imagem'}
          </button>
        </>
      )}
      <input
        id={id}
        aria-label={`${label}: endereço`}
        value={src}
        placeholder='https://…'
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </div>
  )
}

export function ImageControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'image', CanvasImage>) {
  const current = value ?? { src: '', alt: '' }
  return (
    <div className='flex flex-col gap-2'>
      <ImagePicker
        id={id}
        label={label}
        src={current.src}
        accept={control.accept}
        onChange={(src) => onChange({ ...current, src })}
      />
      <SubField label='Texto alternativo'>
        <input
          aria-label={`${label}: texto alternativo`}
          value={current.alt}
          placeholder='Descreva a imagem para leitores de tela'
          onChange={(event) =>
            onChange({ ...current, alt: event.target.value })
          }
          className={inputClass}
        />
      </SubField>
    </div>
  )
}

const LINK_META: Record<
  CanvasLinkTarget,
  { label: string; icon: IconSvgElement; placeholder: string }
> = {
  url: { label: 'Endereço web', icon: Globe02Icon, placeholder: 'https://…' },
  page: {
    label: 'Página do site',
    icon: WebDesign01Icon,
    placeholder: 'Página',
  },
  anchor: {
    label: 'Âncora na página',
    icon: HashtagIcon,
    placeholder: 'secao-de-contato',
  },
  email: { label: 'E-mail', icon: Mail01Icon, placeholder: 'nome@empresa.com' },
  phone: {
    label: 'Telefone',
    icon: Call02Icon,
    placeholder: '+55 11 99999-0000',
  },
  file: {
    label: 'Arquivo',
    icon: File01Icon,
    placeholder: 'https://…/arquivo.pdf',
  },
}

export function LinkControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'link', CanvasLink>) {
  const targets = control.targets ?? [...LINK_TARGETS]
  const current: CanvasLink = value ?? { type: targets[0] ?? 'url', value: '' }
  const meta = LINK_META[current.type]
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex gap-1.5'>
        {targets.length > 1 && (
          <Select
            value={current.type}
            onValueChange={(type) => {
              if (typeof type === 'string') {
                onChange({
                  ...current,
                  type: type as CanvasLinkTarget,
                  value: '',
                })
              }
            }}
          >
            <SelectTrigger
              aria-label={`${label}: tipo`}
              size='sm'
              className='w-[4.5rem] shrink-0 px-2'
            >
              <SelectValue>
                {(type: CanvasLinkTarget) => (
                  <SteelIcon
                    icon={LINK_META[type]?.icon ?? Globe02Icon}
                    className='size-4'
                  />
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {targets.map((target) => (
                <SelectItem key={target} value={target} className='text-xs'>
                  <SteelIcon
                    icon={LINK_META[target].icon}
                    className='size-3.5'
                  />
                  {LINK_META[target].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <input
          id={id}
          aria-label={`${label}: ${meta.label}`}
          value={current.value}
          placeholder={meta.placeholder}
          type={
            current.type === 'email'
              ? 'email'
              : current.type === 'phone'
                ? 'tel'
                : 'text'
          }
          onChange={(event) =>
            onChange({ ...current, value: event.target.value })
          }
          className={inputClass}
        />
      </div>
      {control.quickValues?.length ? (
        <div className='flex flex-wrap gap-1'>
          {control.quickValues.map((quick) => {
            const active =
              current.type === 'url' && current.value === quick.value
            return (
              <button
                key={quick.value}
                type='button'
                aria-pressed={active}
                onClick={() =>
                  onChange({ ...current, type: 'url', value: quick.value })
                }
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted',
                  active && 'border-primary bg-primary/10 text-foreground',
                )}
              >
                {quick.label}
              </button>
            )
          })}
        </div>
      ) : null}
      {(current.type === 'url' ||
        current.type === 'file' ||
        current.type === 'page') && (
        <div className='flex items-center justify-between text-xs text-muted-foreground'>
          Abrir em nova aba
          <Switch
            aria-label='Abrir em nova aba'
            size='sm'
            checked={!!current.newTab}
            onCheckedChange={(newTab) =>
              onChange({ ...current, newTab: newTab || undefined })
            }
          />
        </div>
      )}
    </div>
  )
}

const UNIT_LABELS: Record<CanvasSizeUnit, string> = {
  px: 'px',
  '%': '%',
  auto: 'Auto',
  fill: 'Preencher',
  vh: 'vh',
}

export function SizeControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'size', CanvasSize>) {
  const units = control.units ?? [...SIZE_UNITS]
  const current: CanvasSize = value ?? {
    value: null,
    unit: units.includes('auto') ? 'auto' : units[0],
  }
  const numeric = current.unit !== 'auto' && current.unit !== 'fill'
  return (
    <div className='flex gap-1.5'>
      {numeric ? (
        <NumberInput
          id={id}
          label={label}
          value={current.value ?? undefined}
          min={0}
          max={current.unit === 'px' ? 10000 : 100}
          allowEmpty
          placeholder='Auto'
          onChange={(next) => onChange({ ...current, value: next ?? null })}
        />
      ) : (
        <div className='flex h-8 flex-1 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground'>
          {current.unit === 'fill'
            ? 'Ocupa o espaço disponível'
            : 'Ajusta ao conteúdo'}
        </div>
      )}
      <Select
        value={current.unit}
        onValueChange={(unit) => {
          if (typeof unit !== 'string') return
          const next = unit as CanvasSizeUnit
          onChange({
            unit: next,
            value:
              next === 'auto' || next === 'fill'
                ? null
                : (current.value ?? (next === '%' ? 100 : null)),
          })
        }}
      >
        <SelectTrigger
          aria-label={`${label}: unidade`}
          size='sm'
          className='w-24 shrink-0 text-xs'
        >
          <SelectValue>
            {(unit: CanvasSizeUnit) => UNIT_LABELS[unit] ?? unit}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {units.map((unit) => (
            <SelectItem key={unit} value={unit} className='text-xs'>
              {UNIT_LABELS[unit]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const BREAKPOINT_ICONS = {
  base: ComputerIcon,
  tablet: Tablet01Icon,
  mobile: SmartPhone01Icon,
}

export function VisibilityControl({
  id,
  label,
  value,
  onChange,
}: ControlProps<'visibility', CanvasVisibility>) {
  const { catalog } = useCanvasEditor()
  const current = value ?? VISIBLE_EVERYWHERE
  const breakpoints = CANVAS_BREAKPOINTS.filter((bp) =>
    catalog.breakpoints.includes(bp),
  )
  return (
    <div id={id} role='toolbar' aria-label={label} className='flex gap-1.5'>
      {breakpoints.map((bp) => {
        const shown = current[bp]
        return (
          <button
            key={bp}
            type='button'
            aria-pressed={shown}
            aria-label={`${shown ? 'Visível' : 'Oculto'} em ${BREAKPOINT_LABELS[bp]}`}
            onClick={() => onChange({ ...current, [bp]: !shown })}
            className={cn(
              'flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              shown
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'text-muted-foreground line-through hover:bg-muted',
            )}
          >
            <SteelIcon icon={BREAKPOINT_ICONS[bp]} className='size-4' />
            {BREAKPOINT_LABELS[bp]}
          </button>
        )
      })}
    </div>
  )
}
