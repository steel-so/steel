import type { CanvasDocument } from '@/src/lib/canvas/types'
import { DOCUMENT_FIELD_TYPES, type DocumentFieldType } from './constants'
import type { DocumentFieldProps } from './context'

export interface DocumentFieldInfo extends DocumentFieldProps {
  /** Field node id (the key of the answers). */
  id: string
  type: DocumentFieldType
}

const FIELD_TYPES: ReadonlySet<string> = new Set(DOCUMENT_FIELD_TYPES)

/**
 * Every visible form field of a document. The service validates accept and
 * submit answers against this list (required, type: CPF/CNPJ/e-mail/date).
 */
export function documentFields(doc: CanvasDocument): DocumentFieldInfo[] {
  const fields: DocumentFieldInfo[] = []
  for (const node of Object.values(doc.nodes)) {
    if (!FIELD_TYPES.has(node.type) || node.meta?.hidden) continue
    const props = node.props as Partial<DocumentFieldProps>
    fields.push({
      id: node.id,
      type: node.type as DocumentFieldType,
      label: typeof props.label === 'string' ? props.label : 'Campo',
      required: props.required === true,
      placeholder: props.placeholder,
      helpText: props.helpText,
      options: Array.isArray(props.options) ? props.options : undefined,
      multiple: props.multiple === true,
      crmField: props.crmField,
    })
  }
  return fields
}
