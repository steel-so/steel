'use client'

import { useState } from 'react'
import { MeetingBookingWidget } from '@/app/_components/crm/meetings/public/meeting-booking-widget'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@/components/ui/questionnaire'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  hasCampaignRef,
  readCampaignRefParams,
} from '@/src/lib/crm-campaign/campaign-url'
import { groupFieldsByPhase } from '@/src/schemas/crm-form.schema'
import type { CrmFormFieldDefinition, CrmFormPublicDTO } from '@/types/crm-form'

/** Multichannel campaign link (utm_* + stc) of the page, when present. */
function campaignRefOfPage() {
  if (typeof window === 'undefined') return undefined
  const ref = readCampaignRefParams(window.location.search)
  return hasCampaignRef(ref) ? ref : undefined
}

type Values = Record<string, unknown>

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: CrmFormFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  disabled: boolean
}) {
  const id = `field-${field.key}`

  if (field.type === 'textarea') {
    return (
      <Textarea
        id={id}
        value={(value as string) ?? ''}
        placeholder={field.placeholder}
        required={field.required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <Select
        value={(value as string) ?? ''}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className='w-full'>
          <SelectValue placeholder={field.placeholder ?? 'Selecione…'} />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div className='flex items-center gap-2'>
        <Checkbox
          id={id}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <Label htmlFor={id} className='font-normal text-muted-foreground'>
          {field.placeholder ?? field.label}
        </Label>
      </div>
    )
  }

  const inputType =
    field.type === 'email'
      ? 'email'
      : field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'url'
            ? 'url'
            : field.type === 'phone'
              ? 'tel'
              : 'text'

  return (
    <Input
      id={id}
      type={inputType}
      value={(value as string) ?? ''}
      placeholder={field.placeholder}
      required={field.required}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Name, e-mail and phone the visitor just typed, to pre-fill the booking. */
function bookingPrefill(
  fields: CrmFormFieldDefinition[],
  values: Values,
): { name?: string; email?: string; phone?: string } {
  const text = (field: CrmFormFieldDefinition | undefined) => {
    const value = field ? values[field.key] : undefined
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return {
    name: text(fields.find((field) => field.mapping.attribute === 'name')),
    email: text(fields.find((field) => field.type === 'email')),
    phone: text(fields.find((field) => field.type === 'phone')),
  }
}

function FieldGroup({
  fields,
  values,
  setValue,
  disabled,
}: {
  fields: CrmFormFieldDefinition[]
  values: Values
  setValue: (key: string, value: unknown) => void
  disabled: boolean
}) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className='flex flex-col gap-1.5'>
          {field.type !== 'checkbox' ? (
            <Label htmlFor={`field-${field.key}`}>
              {field.label}
              {field.required ? (
                <span className='text-destructive'> *</span>
              ) : null}
            </Label>
          ) : null}
          <FieldControl
            field={field}
            value={values[field.key]}
            onChange={(value) => setValue(field.key, value)}
            disabled={disabled}
          />
        </div>
      ))}
    </>
  )
}

/**
 * Renderiza o formulário no visual travado do sistema. Compartilhado entre a
 * página pública (`publicToken` definido → envia de verdade) e o preview do
 * builder (`preview` → controles desativados, sem envio).
 */
export function CrmPublicFormRenderer({
  form,
  publicToken,
  preview = false,
}: {
  form: CrmFormPublicDTO
  publicToken?: string
  preview?: boolean
}) {
  const [values, setValues] = useState<Values>({})
  const [honeypot, setHoneypot] = useState('')
  const [newsletterConsent, setNewsletterConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function setValue(key: string, value: unknown) {
    setValues((cur) => ({ ...cur, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (preview || !publicToken) return
    if (honeypot) return // bot preencheu o campo isca — descarta silenciosamente
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/forms/${publicToken}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values,
          campaign: campaignRefOfPage(),
          ...(form.newsletter && { newsletterConsent }),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json?.message ?? 'Não foi possível enviar. Tente novamente.')
        return
      }
      // A form with a booking page keeps the visitor here so they can pick a
      // time right away; the redirect only applies to forms without one.
      if (form.redirectUrl && !form.booking) {
        window.location.href = form.redirectUrl
        return
      }
      setDone(form.successMessage ?? 'Recebemos suas informações. Obrigado!')
    } catch {
      setError('Erro de rede. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className='flex flex-col gap-6'>
        <div className='rounded-xl border bg-card p-8 text-center'>
          <p className='font-medium text-base'>{done}</p>
        </div>
        {form.booking ? (
          <div className='rounded-xl border bg-card p-6'>
            <MeetingBookingWidget
              page={form.booking}
              compact
              prefill={bookingPrefill(form.fields, values)}
            />
          </div>
        ) : null}
      </div>
    )
  }

  const honeypotField = (
    // Honeypot anti-spam: oculto para humanos, atrativo para bots.
    <div aria-hidden className='hidden'>
      <label htmlFor='company_website'>Não preencha</label>
      <input
        id='company_website'
        name='company_website'
        tabIndex={-1}
        autoComplete='off'
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
      />
    </div>
  )

  const disabled = preview || submitting

  // Optional consent box of a form that subscribes to a newsletter (ADR
  // 0054): never pre-ticked, never required to send the form.
  const newsletterField = form.newsletter ? (
    <div className='flex items-start gap-2'>
      <Checkbox
        id='newsletter-consent'
        checked={newsletterConsent}
        disabled={disabled}
        onCheckedChange={(checked) => setNewsletterConsent(checked === true)}
      />
      <Label
        htmlFor='newsletter-consent'
        className='font-normal text-muted-foreground leading-snug'
      >
        {form.newsletter.consentText}
      </Label>
    </div>
  ) : null
  const grouped = groupFieldsByPhase(form.fields, form.phases)

  if (grouped.length > 1) {
    return (
      <Questionnaire
        onSubmit={onSubmit}
        defaultItem={grouped[0].phase.id}
        className='rounded-xl border bg-card p-6 sm:p-8'
      >
        <div className='mb-1 flex flex-col gap-1'>
          <h1 className='font-semibold text-xl tracking-tight'>{form.name}</h1>
          {form.description ? (
            <p className='text-muted-foreground text-sm'>{form.description}</p>
          ) : null}
        </div>

        <QuestionnaireProgress />

        {grouped.map(({ phase, fields }) => (
          <QuestionnaireItem key={phase.id} name={phase.id}>
            <QuestionnaireTitle>{phase.title}</QuestionnaireTitle>
            {phase.description ? (
              <QuestionnaireDescription>
                {phase.description}
              </QuestionnaireDescription>
            ) : null}
            <FieldGroup
              fields={fields}
              values={values}
              setValue={setValue}
              disabled={disabled}
            />
          </QuestionnaireItem>
        ))}

        {newsletterField}
        {honeypotField}
        {error ? <p className='text-destructive text-sm'>{error}</p> : null}

        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireNext />
          <QuestionnaireSubmit disabled={disabled}>
            {submitting ? 'Enviando…' : 'Enviar'}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className='flex flex-col gap-5 rounded-xl border bg-card p-6 sm:p-8'
    >
      <div className='flex flex-col gap-1'>
        <h1 className='font-semibold text-xl tracking-tight'>{form.name}</h1>
        {form.description ? (
          <p className='text-muted-foreground text-sm'>{form.description}</p>
        ) : null}
      </div>

      {form.fields.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Este formulário ainda não possui campos.
        </p>
      ) : null}

      <FieldGroup
        fields={form.fields}
        values={values}
        setValue={setValue}
        disabled={disabled}
      />

      {newsletterField}
      {honeypotField}
      {error ? <p className='text-destructive text-sm'>{error}</p> : null}

      <Button type='submit' disabled={disabled} className='w-full'>
        {submitting ? 'Enviando…' : 'Enviar'}
      </Button>
    </form>
  )
}
