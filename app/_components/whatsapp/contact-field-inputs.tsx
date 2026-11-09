'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type CustomFieldType,
  formatCustomFieldValue,
} from '@/src/lib/custom-field-value'
import type { WhatsAppContactFieldDTO } from '@/types/whatsapp-contact'

/** Form state of the contact fields: `definitionId -> text typed`. */
export type ContactFieldFormValues = Record<string, string>

const NONE = '__none__'

/** Progressive mask while typing (CPF, CNPJ, CEP); other types pass through. */
export function maskContactFieldInput(
  type: CustomFieldType,
  value: string,
): string {
  const digits = value.replace(/\D/g, '')
  switch (type) {
    case 'CPF':
      return digits
        .slice(0, 11)
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    case 'CNPJ':
      return digits
        .slice(0, 14)
        .replace(/(\d{2})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1/$2')
        .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
    case 'CEP':
      return digits.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
    default:
      return value
  }
}

/** Stored values (digits, ISO dates...) → what the inputs show. */
export function contactFieldsToForm(
  fields: WhatsAppContactFieldDTO[],
  stored: Record<string, string | number | boolean | null> | undefined,
): ContactFieldFormValues {
  const form: ContactFieldFormValues = {}
  for (const field of fields) {
    const value = stored?.[field.id]
    if (value === null || value === undefined) {
      form[field.id] = ''
    } else if (field.type === 'DATE') {
      form[field.id] = String(value).slice(0, 10)
    } else if (field.type === 'BOOLEAN') {
      form[field.id] = value ? 'sim' : 'nao'
    } else if (
      field.type === 'CPF' ||
      field.type === 'CNPJ' ||
      field.type === 'CEP'
    ) {
      form[field.id] = formatCustomFieldValue(field.type, value)
    } else {
      form[field.id] = String(value)
    }
  }
  return form
}

/**
 * Form → request body. Empty inputs go as `null` (clears a stored value); the
 * server validates and normalizes each one by its field type.
 */
export function contactFieldsToPayload(
  fields: WhatsAppContactFieldDTO[],
  values: ContactFieldFormValues,
): Record<string, string | null> {
  const payload: Record<string, string | null> = {}
  for (const field of fields) {
    const text = (values[field.id] ?? '').trim()
    payload[field.id] = text === '' ? null : text
  }
  return payload
}

const INPUT_TYPE: Partial<Record<CustomFieldType, string>> = {
  NUMBER: 'text',
  DATE: 'date',
  EMAIL: 'email',
  URL: 'url',
  PHONE: 'tel',
}

const PLACEHOLDER: Partial<Record<CustomFieldType, string>> = {
  CPF: '000.000.000-00',
  CNPJ: '00.000.000/0000-00',
  CEP: '00000-000',
  PHONE: '(11) 99999-9999',
  EMAIL: 'nome@empresa.com.br',
  URL: 'https://...',
}

/** One labelled input per contact field, shaped by the field's type. */
export function ContactFieldInputs({
  fields,
  values,
  onChange,
}: {
  fields: WhatsAppContactFieldDTO[]
  values: ContactFieldFormValues
  onChange: (values: ContactFieldFormValues) => void
}) {
  if (fields.length === 0) return null

  function set(id: string, value: string) {
    onChange({ ...values, [id]: value })
  }

  return (
    <>
      {fields.map((field) => {
        const id = `contact-field-${field.id}`
        const value = values[field.id] ?? ''
        const choices =
          field.type === 'SELECT'
            ? field.options
            : field.type === 'BOOLEAN'
              ? ['sim', 'nao']
              : null
        const labelOf = (choice: string) =>
          field.type === 'BOOLEAN' ? (choice === 'sim' ? 'Sim' : 'Não') : choice

        return (
          <div key={field.id} className='space-y-1.5'>
            <Label htmlFor={id}>
              {field.label}
              {field.required ? ' *' : ''}
            </Label>
            {choices ? (
              <Select
                items={[
                  { value: NONE, label: '—' },
                  ...choices.map((choice) => ({
                    value: choice,
                    label: labelOf(choice),
                  })),
                ]}
                value={value === '' ? NONE : value}
                onValueChange={(next) =>
                  set(field.id, next === NONE ? '' : (next ?? ''))
                }
              >
                <SelectTrigger id={id} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NONE}>—</SelectItem>
                    {choices.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {labelOf(choice)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                type={INPUT_TYPE[field.type] ?? 'text'}
                inputMode={
                  field.type === 'NUMBER' ||
                  field.type === 'CPF' ||
                  field.type === 'CNPJ' ||
                  field.type === 'CEP'
                    ? 'numeric'
                    : undefined
                }
                required={field.required}
                placeholder={PLACEHOLDER[field.type]}
                value={value}
                onChange={(event) =>
                  set(
                    field.id,
                    maskContactFieldInput(field.type, event.target.value),
                  )
                }
              />
            )}
          </div>
        )
      })}
    </>
  )
}
