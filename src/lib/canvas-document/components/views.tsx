import type { ReactNode } from 'react'
import type {
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
} from '@/src/schemas/document.schema'
import type { DocumentFieldType } from '../constants'
import type { DocumentPricingItem } from '../context'
import {
  formatBRL,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  maskCnpj,
  maskCpf,
  maskPhone,
  onlyDigits,
} from '../format'
import { pricingLineTotal } from '../pricing'
import type { DocumentFieldSchemaProps } from '../schemas'

/**
 * Presentational pieces shared by the static renders (editor, print) and
 * the live elements of the public link: the pricing table and the form
 * fields. No hooks here — the live components own the state and pass
 * values and handlers down.
 */

export type FieldValue = DocumentFieldValuesDTO[string]

// ─── pricing ──────────────────────────────────────────────────────────────

export interface PricingRow {
  item: DocumentPricingItem
  selected: boolean
  quantity: number
  total: number
}

/** Each line with the reader's choice applied (or the defaults). */
export function pricingRows(
  items: DocumentPricingItem[],
  selection?: DocumentPricingSelectionDTO,
): PricingRow[] {
  return items.map((item) => {
    const choice = selection?.[item.id]
    const picked = choice?.selected ?? item.selectedByDefault ?? false
    const quantity =
      item.quantityEditable && choice ? choice.quantity : item.quantity
    return {
      item,
      selected: item.optional ? picked : true,
      quantity,
      total: pricingLineTotal(item, selection),
    }
  })
}

export interface PricingSums {
  once: number
  monthly: number
  yearly: number
  total: number
}

export function pricingSums(rows: PricingRow[]): PricingSums {
  const sums: PricingSums = { once: 0, monthly: 0, yearly: 0, total: 0 }
  for (const row of rows) {
    const key = row.item.recurrence ?? 'once'
    sums[key] = Math.round((sums[key] + row.total) * 100) / 100
    sums.total = Math.round((sums.total + row.total) * 100) / 100
  }
  return sums
}

const RECURRENCE_SUFFIX: Record<string, string> = {
  monthly: '/mês',
  yearly: '/ano',
}

function quantityLabel(quantity: number, unit?: string): string {
  const value = quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return unit ? `${value} ${unit}` : value
}

export interface PricingTableViewProps {
  title?: ReactNode
  items: DocumentPricingItem[]
  selection?: DocumentPricingSelectionDTO
  showTotals: boolean
  showDescriptions: boolean
  note?: ReactNode
  attributes?: Record<string, string | undefined>
  /** Live link: tick optional lines and change quantities. */
  onToggle?: (row: PricingRow, selected: boolean) => void
  onQuantity?: (row: PricingRow, quantity: number) => void
}

export function PricingTableView({
  title,
  items,
  selection,
  showTotals,
  showDescriptions,
  note,
  attributes,
  onToggle,
  onQuantity,
}: PricingTableViewProps) {
  const rows = pricingRows(items, selection)
  const sums = pricingSums(rows)
  const hasDiscount = items.some((item) => (item.discountPct ?? 0) > 0)
  const recurring = sums.monthly > 0 || sums.yearly > 0
  return (
    <div {...attributes} className='d-pricing'>
      {title ? <h3 className='d-pricing-title'>{title}</h3> : null}
      <table className='d-pricing-table'>
        <thead>
          <tr>
            <th scope='col'>Item</th>
            <th scope='col' className='d-num'>
              Qtd.
            </th>
            <th scope='col' className='d-num'>
              Valor unitário
            </th>
            {hasDiscount ? (
              <th scope='col' className='d-num'>
                Desconto
              </th>
            ) : null}
            <th scope='col' className='d-num'>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PricingLine
              key={row.item.id}
              row={row}
              hasDiscount={hasDiscount}
              showDescription={showDescriptions}
              onToggle={onToggle}
              onQuantity={onQuantity}
            />
          ))}
        </tbody>
      </table>
      {showTotals ? (
        <dl className='d-pricing-totals'>
          {recurring && sums.once > 0 ? (
            <div>
              <dt>Pagamento único</dt>
              <dd>{formatBRL(sums.once)}</dd>
            </div>
          ) : null}
          {sums.monthly > 0 ? (
            <div>
              <dt>Mensalidade</dt>
              <dd>{formatBRL(sums.monthly)}/mês</dd>
            </div>
          ) : null}
          {sums.yearly > 0 ? (
            <div>
              <dt>Anuidade</dt>
              <dd>{formatBRL(sums.yearly)}/ano</dd>
            </div>
          ) : null}
          <div className='d-pricing-total'>
            <dt>{recurring ? 'Total do primeiro ciclo' : 'Total'}</dt>
            <dd>{formatBRL(sums.total)}</dd>
          </div>
        </dl>
      ) : null}
      {note ? <p className='d-pricing-note'>{note}</p> : null}
    </div>
  )
}

function PricingLine({
  row,
  hasDiscount,
  showDescription,
  onToggle,
  onQuantity,
}: {
  row: PricingRow
  hasDiscount: boolean
  showDescription: boolean
  onToggle?: PricingTableViewProps['onToggle']
  onQuantity?: PricingTableViewProps['onQuantity']
}) {
  const { item } = row
  const suffix = RECURRENCE_SUFFIX[item.recurrence ?? 'once'] ?? ''
  const checkboxId = `d-price-${item.id}`
  const qtyHandler =
    item.quantityEditable && row.selected ? onQuantity : undefined
  return (
    <tr className={row.selected ? undefined : 'd-pricing-off'}>
      <td>
        <div className='d-pricing-name'>
          {item.optional && onToggle ? (
            <input
              id={checkboxId}
              type='checkbox'
              checked={row.selected}
              onChange={(event) => onToggle(row, event.target.checked)}
            />
          ) : null}
          <span>
            {item.optional && onToggle ? (
              <label htmlFor={checkboxId}>{item.name}</label>
            ) : (
              item.name
            )}
            {item.optional ? (
              <span className='d-tag d-tag--muted'>Opcional</span>
            ) : null}
            {suffix ? (
              <span className='d-tag'>
                {item.recurrence === 'monthly' ? 'Mensal' : 'Anual'}
              </span>
            ) : null}
          </span>
        </div>
        {showDescription && item.description ? (
          <div className='d-pricing-desc'>{item.description}</div>
        ) : null}
      </td>
      <td className='d-num' data-label='Qtd.'>
        {qtyHandler ? (
          <input
            className='d-input d-qty'
            type='number'
            min={0}
            step='any'
            inputMode='decimal'
            aria-label={`Quantidade de ${item.name}`}
            value={row.quantity}
            onChange={(event) => {
              const next = Number(event.target.value)
              qtyHandler(row, Number.isFinite(next) ? Math.max(next, 0) : 0)
            }}
          />
        ) : (
          quantityLabel(row.quantity, item.unit)
        )}
      </td>
      <td className='d-num' data-label='Valor unitário'>
        {formatBRL(item.unitPrice)}
      </td>
      {hasDiscount ? (
        <td className='d-num' data-label='Desconto'>
          {item.discountPct ? `${item.discountPct}%` : '—'}
        </td>
      ) : null}
      <td className='d-num d-pricing-line' data-label='Total'>
        {formatBRL(row.total)}
        {suffix}
      </td>
    </tr>
  )
}

// ─── fields ───────────────────────────────────────────────────────────────

const FIELD_HINTS: Partial<Record<DocumentFieldType, string>> = {
  'field-email': 'nome@empresa.com.br',
  'field-phone': '(00) 00000-0000',
  'field-date': 'dd/mm/aaaa',
  'field-cpf': '000.000.000-00',
  'field-cnpj': '00.000.000/0000-00',
  'field-number': '0',
  'field-select': 'Selecione…',
}

const INPUT_TYPES: Partial<Record<DocumentFieldType, string>> = {
  'field-email': 'email',
  'field-phone': 'tel',
  'field-date': 'date',
}

type InputMode = 'numeric' | 'email' | 'tel'

const INPUT_MODES: Partial<Record<DocumentFieldType, InputMode>> = {
  'field-email': 'email',
  'field-phone': 'tel',
  'field-cpf': 'numeric',
  'field-cnpj': 'numeric',
}

const AUTOCOMPLETE: Partial<Record<DocumentFieldType, string>> = {
  'field-email': 'email',
  'field-phone': 'tel',
}

export function fieldInputId(id: string): string {
  return `d-field-${id}`
}

/** Error shown on blur for a complete but invalid value (the service
 * validates again on accept/submit). */
export function fieldValueError(
  type: DocumentFieldType,
  value: FieldValue | undefined,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  if (type === 'field-cpf' && !isValidCpf(value)) return 'CPF inválido.'
  if (type === 'field-cnpj' && !isValidCnpj(value)) return 'CNPJ inválido.'
  if (type === 'field-email' && !isValidEmail(value)) {
    return 'E-mail inválido.'
  }
  if (type === 'field-phone' && onlyDigits(value).length < 10) {
    return 'Telefone incompleto.'
  }
  return null
}

/** The value as typed, with the mask of the field type applied. */
export function maskFieldValue(type: DocumentFieldType, raw: string): string {
  if (type === 'field-cpf') return maskCpf(raw)
  if (type === 'field-cnpj') return maskCnpj(raw)
  if (type === 'field-phone') return maskPhone(raw)
  return raw
}

/** Display form of an answer (print, accepted documents). */
export function formatFieldValue(
  type: DocumentFieldType,
  value: FieldValue | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return value.toLocaleString('pt-BR')
  if (type === 'field-date') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value
  }
  return maskFieldValue(type, value)
}

function FieldLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor?: string
  label: ReactNode
  required?: boolean
}) {
  const mark = required ? (
    <span className='d-req' aria-hidden='true'>
      *
    </span>
  ) : null
  return htmlFor ? (
    <label className='d-label' htmlFor={htmlFor}>
      {label}
      {mark}
    </label>
  ) : (
    <span className='d-label'>
      {label}
      {mark}
    </span>
  )
}

export interface FieldViewProps {
  id: string
  type: DocumentFieldType
  props: DocumentFieldSchemaProps
  label: ReactNode
  attributes?: Record<string, string | undefined>
}

/** Editor: what the field looks like, with a typed example. */
export function FieldPreview({
  type,
  props,
  label,
  attributes,
}: FieldViewProps) {
  if (type === 'field-checkbox') {
    return (
      <div {...attributes} className='d-field'>
        <span className='d-check'>
          <span className='d-check-box' />
          <span>
            {label}
            {props.required ? <span className='d-req'>*</span> : null}
          </span>
        </span>
        {props.helpText ? (
          <span className='d-help'>{props.helpText}</span>
        ) : null}
      </div>
    )
  }
  const options = props.options?.filter((option) => option.trim()) ?? []
  const multiple = type === 'field-select' && props.multiple
  const shown = options.length > 0 ? options : ['Opção 1', 'Opção 2']
  const fakeClass =
    type === 'field-textarea'
      ? 'd-input d-input--fake d-input--area'
      : 'd-input d-input--fake'
  return (
    <div {...attributes} className='d-field'>
      <FieldLabel label={label} required={props.required} />
      {multiple ? (
        <span className='d-options'>
          {shown.map((option) => (
            <span key={option} className='d-check'>
              <span className='d-check-box' />
              {option}
            </span>
          ))}
        </span>
      ) : (
        <span className={fakeClass}>
          {props.placeholder || FIELD_HINTS[type] || ''}
        </span>
      )}
      {props.helpText ? <span className='d-help'>{props.helpText}</span> : null}
    </div>
  )
}

/** Print: the label and the answer (or a blank line to fill by hand). */
export function FieldPrinted({
  type,
  props,
  label,
  value,
}: FieldViewProps & { value?: FieldValue }) {
  if (type === 'field-checkbox') {
    return (
      <div className='d-field'>
        <span className='d-check'>
          <span className='d-check-box'>{value === true ? '✓' : ''}</span>
          <span>{label}</span>
        </span>
      </div>
    )
  }
  return (
    <div className='d-field'>
      <FieldLabel label={label} required={props.required} />
      <div className='d-value'>{formatFieldValue(type, value)}</div>
    </div>
  )
}

export interface FieldInputProps extends FieldViewProps {
  value?: FieldValue
  error?: string
  disabled?: boolean
  onChange: (value: FieldValue) => void
  onBlur?: () => void
}

/** Public link: the real input, controlled by the runtime. */
export function FieldInput({
  id,
  type,
  props,
  label,
  value,
  error,
  disabled,
  onChange,
  onBlur,
}: FieldInputProps) {
  const inputId = fieldInputId(id)
  const helpId = props.helpText ? `${inputId}-help` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const common = {
    id: inputId,
    name: id,
    disabled,
    required: props.required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    onBlur,
  }
  const text = typeof value === 'string' ? value : ''
  const onText = (raw: string) => onChange(maskFieldValue(type, raw))
  const footer = (
    <>
      {props.helpText ? (
        <span id={helpId} className='d-help'>
          {props.helpText}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className='d-error' role='alert'>
          {error}
        </span>
      ) : null}
    </>
  )

  if (type === 'field-checkbox') {
    return (
      <div className='d-field'>
        <label className='d-check' htmlFor={inputId}>
          <input
            {...common}
            type='checkbox'
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>
            {label}
            {props.required ? <span className='d-req'>*</span> : null}
          </span>
        </label>
        {footer}
      </div>
    )
  }

  const options = props.options?.filter((option) => option.trim()) ?? []
  if (type === 'field-select' && props.multiple) {
    const picked = Array.isArray(value) ? value : []
    const toggle = (option: string, checked: boolean) => {
      const next = picked.filter((item) => item !== option)
      onChange(checked ? [...next, option] : next)
    }
    return (
      <fieldset className='d-field d-fieldset'>
        <legend className='d-label'>
          {label}
          {props.required ? <span className='d-req'>*</span> : null}
        </legend>
        <div className='d-options'>
          {options.map((option, index) => (
            <label key={option} className='d-check'>
              <input
                type='checkbox'
                name={id}
                id={index === 0 ? inputId : undefined}
                disabled={disabled}
                checked={picked.includes(option)}
                onChange={(event) => toggle(option, event.target.checked)}
              />
              {option}
            </label>
          ))}
        </div>
        {footer}
      </fieldset>
    )
  }

  let control: ReactNode
  if (type === 'field-select') {
    control = (
      <select
        {...common}
        className='d-input'
        value={text}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value=''>{props.placeholder || 'Selecione…'}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  } else if (type === 'field-textarea') {
    control = (
      <textarea
        {...common}
        className='d-input'
        rows={4}
        maxLength={5000}
        placeholder={props.placeholder}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (type === 'field-number') {
    control = (
      <input
        {...common}
        className='d-input'
        type='number'
        inputMode='decimal'
        placeholder={props.placeholder}
        value={typeof value === 'number' ? value : text}
        onChange={(event) => {
          const raw = event.target.value
          const next = Number(raw)
          onChange(raw === '' || !Number.isFinite(next) ? null : next)
        }}
      />
    )
  } else {
    control = (
      <input
        {...common}
        className='d-input'
        type={INPUT_TYPES[type] ?? 'text'}
        inputMode={INPUT_MODES[type]}
        autoComplete={AUTOCOMPLETE[type]}
        maxLength={type === 'field-text' ? 5000 : 320}
        placeholder={props.placeholder || FIELD_HINTS[type]}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
    )
  }
  return (
    <div className='d-field'>
      <FieldLabel htmlFor={inputId} label={label} required={props.required} />
      {control}
      {footer}
    </div>
  )
}
