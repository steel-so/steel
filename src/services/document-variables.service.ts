import type { AppError } from '@/src/errors/app-error'
import type { DocumentVariableValues } from '@/src/lib/canvas-document/context'
import { formatCustomFieldValue } from '@/src/lib/custom-field-value'
import {
  formatDocumentDate,
  formatDocumentMoney,
} from '@/src/lib/documents/format'
import { ok, type Result } from '@/src/lib/result'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'

/** Drops empty values: an unknown tag keeps its sample in the editor only. */
function compact(values: DocumentVariableValues): DocumentVariableValues {
  const result: DocumentVariableValues = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.trim() !== '') {
      result[key as keyof DocumentVariableValues] = value
    }
  }
  return result
}

type RecipientInfo = {
  name: string
  email: string | null
  phone: string | null
}

function phone(value: string | null | undefined): string | undefined {
  return value ? formatCustomFieldValue('PHONE', value) : undefined
}

/**
 * Values of the merge tags (`{{contato.nome}}`...) of a document for one
 * reader, formatted for pt-BR. The contact comes from the linked person,
 * then the linked lead, then the recipient itself.
 */
export const DocumentVariablesService = {
  async forDocument(
    documentId: string,
    recipientId: string | null,
  ): Promise<Result<DocumentVariableValues, AppError>> {
    const context = await DocumentRepository.findVariableContext(documentId)
    if (!context.ok) return context
    const doc = context.value

    let recipient: RecipientInfo | null = null
    if (recipientId) {
      const found = await DocumentRecipientRepository.findById(
        recipientId,
        documentId,
      )
      if (!found.ok && found.error.code !== 'DOCUMENT_RECIPIENT_NOT_FOUND') {
        return found
      }
      recipient = found.ok ? found.value : null
    }

    const contact = doc.person ?? doc.lead
    const contactName = contact?.name ?? recipient?.name
    const contactEmail = contact?.emails[0] ?? recipient?.email ?? undefined
    const contactPhone = phone(contact?.phones[0] ?? recipient?.phone)
    const total = doc.totalValue === null ? null : Number(doc.totalValue)
    const amount = doc.opportunity?.amount
      ? Number(doc.opportunity.amount)
      : null

    return ok(
      compact({
        'destinatario.nome': recipient?.name,
        'destinatario.email': recipient?.email ?? undefined,
        'contato.nome': contactName,
        'contato.email': contactEmail,
        'contato.telefone': contactPhone,
        'empresa.nome': doc.company?.name,
        'empresa.cnpj': doc.company?.cnpj
          ? formatCustomFieldValue('CNPJ', doc.company.cnpj)
          : undefined,
        'oportunidade.titulo': doc.opportunity?.name,
        'oportunidade.valor':
          amount === null ? undefined : formatDocumentMoney(amount),
        'responsavel.nome': doc.owner.name,
        'responsavel.email': doc.owner.email,
        'documento.titulo': doc.title,
        'documento.validade': doc.validUntil
          ? formatDocumentDate(doc.validUntil)
          : undefined,
        'documento.total':
          total === null ? undefined : formatDocumentMoney(total),
        'workspace.nome': doc.workspace.name,
        'data.hoje': formatDocumentDate(new Date()),
      }),
    )
  },
}
