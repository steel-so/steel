'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import {
  SD_NOTIFICATION_EVENTS,
  type SdNotificationEventSpec,
} from '@/src/config/servicedesk-notifications'
import {
  isSdRequesterEvent,
  type SdRequesterTemplateVariable,
} from '@/src/lib/servicedesk/requester-whatsapp'
import type { SdSettingsDTO } from '@/types/sd-settings'
import { SettingsSection } from './sd-settings-kit'

/**
 * "Avisos ao solicitante": para cada evento aberto ao cliente, o modelo
 * aprovado da Meta enviado pelo WhatsApp. Sem modelo, o evento não avisa o
 * cliente por aqui.
 */

type Templates = SdSettingsDTO['requesterWhatsappTemplates']

const VARIABLES: { value: SdRequesterTemplateVariable; label: string }[] = [
  { value: 'code', label: 'Código do chamado' },
  { value: 'title', label: 'Título' },
  { value: 'headline', label: 'Resumo do aviso' },
  { value: 'message', label: 'Mensagem' },
  { value: 'requester', label: 'Nome do cliente' },
]

const EVENTS: SdNotificationEventSpec[] = SD_NOTIFICATION_EVENTS.filter(
  (spec) => isSdRequesterEvent(spec.key),
)

function EventRow({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: SdNotificationEventSpec
  value: Templates[string] | undefined
  disabled: boolean
  onChange: (next: Templates[string] | null) => void
}) {
  const current = value ?? {
    templateName: '',
    language: 'pt_BR',
    variables: [],
  }
  const patch = (changes: Partial<Templates[string]>) => {
    const next = { ...current, ...changes }
    onChange(next.templateName.trim() === '' ? null : next)
  }
  const toggle = (variable: SdRequesterTemplateVariable) =>
    patch({
      variables: current.variables.includes(variable)
        ? current.variables.filter((item) => item !== variable)
        : [...current.variables, variable],
    })

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border p-3'>
      <div className='flex flex-col'>
        <span className='text-sm font-medium'>{spec.label}</span>
        <span className='text-xs text-muted-foreground'>
          {spec.description}
        </span>
      </div>
      <div className='grid gap-2 sm:grid-cols-[1fr_8rem]'>
        <div className='flex flex-col gap-1'>
          <Label htmlFor={`rw-name-${spec.key}`}>Modelo aprovado</Label>
          <Input
            id={`rw-name-${spec.key}`}
            placeholder='ex.: chamado_resolvido'
            value={current.templateName}
            disabled={disabled}
            onChange={(event) => patch({ templateName: event.target.value })}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <Label htmlFor={`rw-lang-${spec.key}`}>Idioma</Label>
          <Input
            id={`rw-lang-${spec.key}`}
            value={current.language}
            disabled={disabled}
            onChange={(event) => patch({ language: event.target.value })}
          />
        </div>
      </div>
      {current.templateName ? (
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-muted-foreground'>
            Variáveis do modelo, na ordem em que você marcar: a primeira
            preenche {'{{1}}'}, a segunda {'{{2}}'}.
          </span>
          <div className='flex flex-wrap gap-1.5'>
            {VARIABLES.map((variable) => {
              const position = current.variables.indexOf(variable.value)
              return (
                <Button
                  key={variable.value}
                  type='button'
                  size='sm'
                  variant={position >= 0 ? 'default' : 'outline'}
                  disabled={disabled}
                  aria-pressed={position >= 0}
                  className='h-7 text-xs'
                  onClick={() => toggle(variable.value)}
                >
                  {position >= 0 ? `${position + 1}. ` : ''}
                  {variable.label}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SdRequesterWhatsappSection({
  saved,
  canEdit,
  pending,
  onSave,
}: {
  saved: Templates
  canEdit: boolean
  pending: boolean
  onSave: (templates: Templates) => void
}) {
  const [draft, setDraft] = useState<Templates>(saved)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const setEvent = (key: string, next: Templates[string] | null) =>
    setDraft((current) => {
      const copy = { ...current }
      if (next) copy[key] = next
      else delete copy[key]
      return copy
    })

  return (
    <SettingsSection
      title='Avisos ao solicitante'
      description='O cliente recebe estes avisos por modelo aprovado da Meta, em vez de texto livre. Fora da janela de 24 h só vai o modelo; quem pediu para não receber mensagens (SAIR) nunca é avisado. Evento sem modelo não avisa o cliente pelo WhatsApp.'
      actions={
        canEdit ? (
          <Button
            size='sm'
            disabled={!dirty || pending}
            onClick={() => {
              const missingLanguage = Object.values(draft).some(
                (template) => !template.language.trim(),
              )
              if (missingLanguage) {
                notify.error('Informe o idioma do modelo, por exemplo pt_BR.')
                return
              }
              onSave(draft)
            }}
          >
            Salvar avisos
          </Button>
        ) : null
      }
    >
      <div className='flex flex-col gap-3'>
        {EVENTS.map((spec) => (
          <EventRow
            key={spec.key}
            spec={spec}
            value={draft[spec.key]}
            disabled={!canEdit || pending}
            onChange={(next) => setEvent(spec.key, next)}
          />
        ))}
      </div>
    </SettingsSection>
  )
}
