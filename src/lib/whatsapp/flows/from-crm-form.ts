import type { CrmFormFieldDTO } from '@/src/schemas/crm-form.schema'
import {
  FLOW_LIMITS,
  type FlowCrmAction,
  type FlowDefinition,
  type FlowField,
  type FlowFieldType,
} from '@/src/schemas/whatsapp-flow.schema'

const TYPE_MAP: Record<CrmFormFieldDTO['type'], FlowFieldType> = {
  text: 'text',
  email: 'email',
  phone: 'phone',
  number: 'number',
  textarea: 'textarea',
  select: 'select',
  checkbox: 'checkbox',
  url: 'text',
  date: 'date',
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function optionId(value: string, index: number): string {
  const slug = value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60)
  return slug || `opt_${index + 1}`
}

/** One CRM form field as a flow field (labels clipped to Meta's limits). */
export function flowFieldFromCrm(field: CrmFormFieldDTO): FlowField {
  const type = TYPE_MAP[field.type]
  const seen = new Set<string>()
  const options = field.options?.map((option, index) => {
    let id = optionId(option.value, index)
    while (seen.has(id)) id = `${id}_${index}`
    seen.add(id)
    return { id, title: clip(option.label, 30) }
  })
  return {
    key: field.key.slice(0, 40),
    label: clip(field.label, FLOW_LIMITS.label[type]),
    type,
    required: field.required ?? false,
    ...(options && options.length > 0 ? { options } : {}),
    mapping: { ...field.mapping },
  }
}

/**
 * A CRM form as a flow definition: same fields and mapping, split into
 * screens of at most `fieldsPerScreen` fields. The CRM action carries over.
 */
export function flowFromCrmForm(
  fields: CrmFormFieldDTO[],
  action: FlowCrmAction,
): { definition: FlowDefinition; crmAction: FlowCrmAction } {
  const converted = fields
    .slice(0, FLOW_LIMITS.fieldsTotal)
    .map(flowFieldFromCrm)
  const screens: FlowDefinition['screens'] = []
  for (let i = 0; i < converted.length; i += FLOW_LIMITS.fieldsPerScreen) {
    screens.push({
      title: `Passo ${screens.length + 1}`,
      fields: converted.slice(i, i + FLOW_LIMITS.fieldsPerScreen),
    })
  }
  return { definition: { screens }, crmAction: action }
}
