'use client'

import { type ReactNode, useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  DOCUMENT_KINDS,
  type DocumentKindDTO,
  type DocumentSettingsDTO,
} from '@/src/schemas/document.schema'
import {
  fromDateInputValue,
  kindLabel,
  toDateInputValue,
} from '../documents-tone'
import { OptionSelect } from '../option-select'
import { useDocumentEditor } from './document-editor-context'
import {
  DOCUMENT_THEME_FONTS,
  readEditableTheme,
  writeEditableTheme,
} from './editor-theme'

const KIND_OPTIONS = DOCUMENT_KINDS.map((kind) => ({
  value: kind,
  label: kindLabel(kind),
}))

const FONT_OPTIONS = DOCUMENT_THEME_FONTS.map(({ value, label }) => ({
  value,
  label,
}))

const HEX = /^#[0-9a-fA-F]{6}$/

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='grid gap-3 border-b px-4 py-4 last:border-b-0'>
      <h3 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <fieldset className='grid gap-1.5'>
      <legend className='mb-1.5 text-sm'>{label}</legend>
      <div className='grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1'>
        {options.map((option) => (
          <button
            key={option.value}
            type='button'
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 rounded-md px-2 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
              value === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className='flex items-start justify-between gap-3'>
      <div className='grid gap-0.5'>
        <Label htmlFor={id} className='font-normal'>
          {label}
        </Label>
        {hint ? (
          <span className='text-muted-foreground text-xs'>{hint}</span>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next)}
      />
    </div>
  )
}

/**
 * Inspector content when nothing is selected: document data (tipo,
 * validade), layout (web or paged, page size, orientation), reading
 * (download, identification, TOC, view alerts), the accept terms and the
 * theme (brand color, fonts, logo). Every change saves on its own.
 */
export function DocumentSettingsPanel() {
  const id = useId()
  const {
    document,
    settings,
    theme,
    canEdit,
    updateSettings,
    updateTheme,
    updateMeta,
  } = useDocumentEditor()
  const editable = readEditableTheme(theme)
  const disabled = !canEdit
  const set = <K extends keyof DocumentSettingsDTO>(
    key: K,
    value: DocumentSettingsDTO[K],
  ) => updateSettings({ [key]: value } as Partial<DocumentSettingsDTO>)

  return (
    <div data-testid='document-settings' className='grid'>
      <Section title='Documento'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-kind`}>Tipo</Label>
          <OptionSelect
            id={`${id}-kind`}
            value={document.kind}
            options={KIND_OPTIONS}
            disabled={disabled}
            onChange={(value) =>
              updateMeta({ kind: value as DocumentKindDTO })
            }
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-valid`}>Válido até</Label>
          <Input
            id={`${id}-valid`}
            type='date'
            disabled={disabled}
            value={toDateInputValue(document.validUntil)}
            onChange={(event) =>
              updateMeta({
                validUntil: event.target.value
                  ? fromDateInputValue(event.target.value)
                  : null,
              })
            }
          />
          <span className='text-muted-foreground text-xs'>
            Depois dessa data o link avisa que expirou e não aceita mais.
          </span>
        </div>
      </Section>

      <Section title='Layout'>
        <Segmented
          label='Formato'
          value={settings.layout}
          disabled={disabled}
          options={[
            { value: 'web', label: 'Página web' },
            { value: 'paged', label: 'Folhas' },
          ]}
          onChange={(value) => set('layout', value)}
        />
        {settings.layout === 'paged' ? (
          <>
            <Segmented
              label='Tamanho da folha'
              value={settings.pageSize}
              disabled={disabled}
              options={[
                { value: 'A4', label: 'A4' },
                { value: 'LETTER', label: 'Carta' },
              ]}
              onChange={(value) => set('pageSize', value)}
            />
            <Segmented
              label='Orientação'
              value={settings.orientation}
              disabled={disabled}
              options={[
                { value: 'portrait', label: 'Retrato' },
                { value: 'landscape', label: 'Paisagem' },
              ]}
              onChange={(value) => set('orientation', value)}
            />
          </>
        ) : (
          <p className='text-muted-foreground text-xs'>
            Rolagem contínua que se ajusta ao celular. O PDF usa folhas A4 em
            retrato.
          </p>
        )}
      </Section>

      <Section title='Leitura'>
        <Toggle
          label='Mostrar sumário'
          hint='Índice flutuante com as seções do documento.'
          checked={settings.showToc}
          disabled={disabled}
          onChange={(value) => set('showToc', value)}
        />
        <Toggle
          label='Permitir baixar PDF'
          hint='O leitor vê o botão de download no link.'
          checked={settings.allowDownload}
          disabled={disabled}
          onChange={(value) => set('allowDownload', value)}
        />
        <Toggle
          label='Pedir identificação'
          hint='No link geral, pede nome e e-mail antes de mostrar.'
          checked={settings.requireIdentification}
          disabled={disabled}
          onChange={(value) => set('requireIdentification', value)}
        />
        <Toggle
          label='Avisar quando abrirem'
          hint='Você recebe um aviso na primeira leitura de cada pessoa.'
          checked={settings.notifyOnView}
          disabled={disabled}
          onChange={(value) => set('notifyOnView', value)}
        />
      </Section>

      <Section title='Aceite'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-terms`}>Texto da confirmação</Label>
          <Textarea
            id={`${id}-terms`}
            rows={3}
            maxLength={500}
            disabled={disabled}
            value={settings.acceptTerms ?? ''}
            placeholder='Li e concordo com os termos desta proposta.'
            onChange={(event) =>
              set('acceptTerms', event.target.value || undefined)
            }
          />
          <span className='text-muted-foreground text-xs'>
            Aparece ao lado da caixa que o leitor marca para aceitar.
          </span>
        </div>
      </Section>

      <Section title='Tema'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-primary`}>Cor principal</Label>
          <div className='flex items-center gap-2'>
            <input
              type='color'
              aria-label='Escolher a cor principal'
              disabled={disabled}
              value={HEX.test(editable.primary) ? editable.primary : '#000000'}
              onChange={(event) =>
                updateTheme(
                  writeEditableTheme(theme, { primary: event.target.value }),
                )
              }
              className='size-9 shrink-0 cursor-pointer rounded-md border bg-background p-1 disabled:cursor-not-allowed'
            />
            <Input
              id={`${id}-primary`}
              key={editable.primary}
              defaultValue={editable.primary}
              disabled={disabled}
              maxLength={7}
              className='font-mono uppercase'
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (HEX.test(value)) {
                  updateTheme(writeEditableTheme(theme, { primary: value }))
                }
              }}
            />
          </div>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-heading-font`}>Fonte dos títulos</Label>
          <OptionSelect
            id={`${id}-heading-font`}
            value={editable.headingFont}
            options={FONT_OPTIONS}
            disabled={disabled}
            onChange={(value) =>
              updateTheme(writeEditableTheme(theme, { headingFont: value }))
            }
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-body-font`}>Fonte do texto</Label>
          <OptionSelect
            id={`${id}-body-font`}
            value={editable.bodyFont}
            options={FONT_OPTIONS}
            disabled={disabled}
            onChange={(value) =>
              updateTheme(writeEditableTheme(theme, { bodyFont: value }))
            }
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-logo`}>Endereço do logo</Label>
          <Input
            id={`${id}-logo`}
            key={editable.logoUrl}
            type='url'
            defaultValue={editable.logoUrl}
            disabled={disabled}
            placeholder='https://…/logo.png'
            onBlur={(event) =>
              updateTheme(
                writeEditableTheme(theme, { logoUrl: event.target.value }),
              )
            }
          />
          <span className='text-muted-foreground text-xs'>
            Usado nos blocos de capa e cabeçalho.
          </span>
        </div>
      </Section>
    </div>
  )
}
