import type {
  FlowDefinition,
  FlowField,
  FlowFieldType,
} from '@/src/schemas/whatsapp-flow.schema'

/**
 * Prefill of a Flow from the contact (static flows). Meta lets the sender
 * pass `data` for the first screen (`flow_action_payload.data` on an
 * interactive message, `flow_action_data` on a template FLOW button); the
 * Flow JSON reads it back through `init-value: ${data.<key>}`. Only fields of
 * the first screen can be prefilled: later screens receive the earlier
 * answers through the navigate payload instead.
 */

/** Field types whose component accepts a text `init-value`. */
const PREFILLABLE_TYPES: ReadonlySet<FlowFieldType> = new Set([
  'text',
  'email',
  'phone',
  'number',
  'textarea',
])

export interface PrefillContact {
  name: string | null
  waId: string
}

const MAX_VALUE = 200
const PHONE_DIGITS = /^\d{8,15}$/

/** True for fields of the first screen the contact data can fill. */
export function isPrefillable(field: FlowField): boolean {
  return PREFILLABLE_TYPES.has(field.type)
}

/** The prefillable fields of the first screen. */
export function prefillFields(definition: FlowDefinition): FlowField[] {
  return (definition.screens[0]?.fields ?? []).filter(isPrefillable)
}

function valueFor(field: FlowField, contact: PrefillContact): string {
  const target = field.mapping?.target
  const attribute = field.mapping?.attribute
  // The contact card holds a name and a phone; nothing else is known.
  if (attribute === 'name' && target !== 'company') {
    return (contact.name ?? '').trim().slice(0, MAX_VALUE)
  }
  const isPhone =
    attribute === 'phone' || (!attribute && field.type === 'phone')
  if (isPhone && PHONE_DIGITS.test(contact.waId)) return contact.waId
  return ''
}

/**
 * `data` for the first screen: one entry per prefillable field, empty when
 * the contact card has nothing for it. Always complete so every `${data.x}`
 * the Flow JSON declares resolves. Empty object when nothing is prefillable.
 */
export function flowPrefillData(
  definition: FlowDefinition,
  contact: PrefillContact,
): Record<string, string> {
  const data: Record<string, string> = {}
  for (const field of prefillFields(definition)) {
    data[field.key] = valueFor(field, contact)
  }
  return data
}
