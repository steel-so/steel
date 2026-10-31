import type {
  FlowDefinition,
  FlowField,
  FlowScreen,
} from '@/src/schemas/whatsapp-flow.schema'
import { isPrefillable } from './prefill'

/** Flow JSON version this generator targets (Meta Flows). */
export const META_FLOW_JSON_VERSION = '7.2'

type Json = Record<string, unknown>

/** Screen ids only accept letters and underscores: A, B... Z, AA, AB... */
export function screenId(index: number): string {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `SCREEN_${letters}`
}

const INPUT_TYPES: Record<string, string> = {
  text: 'text',
  email: 'email',
  phone: 'phone',
  number: 'number',
}

function dataSource(field: FlowField) {
  return (field.options ?? []).map((o) => ({ id: o.id, title: o.title }))
}

function exampleOf(field: FlowField): unknown {
  switch (field.type) {
    case 'checkbox':
      return true
    case 'multiselect':
      return [field.options?.[0]?.id ?? 'a']
    case 'select':
    case 'radio':
      return field.options?.[0]?.id ?? 'a'
    default:
      return 'exemplo'
  }
}

function dataModel(field: FlowField): Json {
  switch (field.type) {
    case 'checkbox':
      return { type: 'boolean', __example__: true }
    case 'multiselect':
      return {
        type: 'array',
        items: { type: 'string' },
        __example__: exampleOf(field),
      }
    default:
      return { type: 'string', __example__: exampleOf(field) }
  }
}

function component(field: FlowField, prefill = false): Json {
  const common = { name: field.key, label: field.label }
  // First-screen text fields start with what the sender passed in `data`.
  const initial = prefill ? { 'init-value': `\${data.${field.key}}` } : {}
  const required = field.required ? { required: true } : {}
  const helper = field.helperText ? { 'helper-text': field.helperText } : {}
  switch (field.type) {
    case 'textarea':
      return { type: 'TextArea', ...common, ...required, ...helper, ...initial }
    case 'select':
      return {
        type: 'Dropdown',
        ...common,
        ...required,
        'data-source': dataSource(field),
      }
    case 'radio':
      return {
        type: 'RadioButtonsGroup',
        ...common,
        ...required,
        'data-source': dataSource(field),
      }
    case 'multiselect':
      return {
        type: 'CheckboxGroup',
        ...common,
        ...required,
        'data-source': dataSource(field),
      }
    case 'checkbox':
      return { type: 'OptIn', ...common, ...required }
    case 'date':
      return { type: 'DatePicker', ...common, ...required, ...helper }
    default:
      return {
        type: 'TextInput',
        ...common,
        ...required,
        ...helper,
        ...initial,
        'input-type': INPUT_TYPES[field.type] ?? 'text',
      }
  }
}

/** All fields of the screens before `index`, carried on as screen data. */
function carried(definition: FlowDefinition, index: number): FlowField[] {
  return definition.screens.slice(0, index).flatMap((screen) => screen.fields)
}

function buildScreen(
  definition: FlowDefinition,
  screen: FlowScreen,
  index: number,
): Json {
  const last = index === definition.screens.length - 1
  const before = carried(definition, index)
  const payload: Json = {}
  for (const field of before) payload[field.key] = `\${data.${field.key}}`
  for (const field of screen.fields)
    payload[field.key] = `\${form.${field.key}}`

  const children: Json[] = []
  if (screen.heading) {
    children.push({ type: 'TextHeading', text: screen.heading })
  }
  if (screen.description) {
    children.push({ type: 'TextBody', text: screen.description })
  }
  children.push({
    type: 'Form',
    name: 'form',
    children: [
      ...screen.fields.map((field) =>
        component(field, index === 0 && isPrefillable(field)),
      ),
      {
        type: 'Footer',
        label: screen.submitLabel || (last ? 'Enviar' : 'Continuar'),
        'on-click-action': last
          ? { name: 'complete', payload }
          : {
              name: 'navigate',
              next: { type: 'screen', name: screenId(index + 1) },
              payload,
            },
      },
    ],
  })

  const data: Json = {}
  for (const field of before) data[field.key] = dataModel(field)
  if (index === 0) {
    for (const field of screen.fields.filter(isPrefillable)) {
      data[field.key] = dataModel(field)
    }
  }

  return {
    id: screenId(index),
    title: screen.title,
    ...(last ? { terminal: true, success: true } : {}),
    ...(Object.keys(data).length > 0 ? { data } : {}),
    layout: { type: 'SingleColumnLayout', children },
  }
}

/**
 * The Flow JSON Meta renders. Multi-screen flows carry the earlier answers
 * forward through each `navigate` payload, so the last screen's `complete`
 * action delivers every answer at once.
 */
export function buildMetaFlowJson(definition: FlowDefinition): Json {
  return {
    version: META_FLOW_JSON_VERSION,
    screens: definition.screens.map((screen, index) =>
      buildScreen(definition, screen, index),
    ),
  }
}

/** Id of the first screen (where a send starts). */
export function firstScreenId(): string {
  return screenId(0)
}
