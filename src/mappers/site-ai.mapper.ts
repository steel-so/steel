import type { SiteFormField } from '@/src/lib/canvas-site/schemas'
import type {
  SiteAiFormData,
  SiteAiTestimonialData,
} from '@/src/lib/site-ai/sections'
import type { EmailProductRow } from '@/src/repositories/crm-email-builder.repository'
import type { CrmFormDTO } from '@/types/crm-form'
import type { SiteAiFormDTO, SiteAiProductDTO } from '@/types/site-ai'
import { toEmailProductData } from './crm-email-builder.mapper'

/** CRM products with the price formatted in pt-BR. */
export function toSiteAiProductDTOs(
  rows: EmailProductRow[],
): SiteAiProductDTO[] {
  const data = toEmailProductData(rows)
  return rows.map((row) => ({ id: row.id, ...data[row.id] }))
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** A landing-page testimonial section's content as testimonial data;
 * `null` when it has no quote or no author. */
export function toSiteAiTestimonial(
  content: unknown,
): SiteAiTestimonialData | null {
  if (typeof content !== 'object' || content === null) return null
  const record = content as Record<string, unknown>
  const quote = text(record.quote, 1000)
  const name = text(record.authorName, 120)
  if (!quote || !name) return null
  return { quote, name, role: text(record.authorRole, 160) }
}

export function toSiteAiFormDTO(form: CrmFormDTO): SiteAiFormDTO {
  return { id: form.id, name: form.name, publicToken: form.publicToken }
}

/** Snapshot of a CRM form kept in the `site.form` node (same as the
 * editor's form picker), so the page renders even if the form changes. */
export function toSiteAiFormData(form: CrmFormDTO): SiteAiFormData {
  return {
    formToken: form.publicToken,
    formName: form.name.slice(0, 200),
    fields: form.fields.slice(0, 50).map(
      (field): SiteFormField => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.options?.length ? { options: field.options } : {}),
      }),
    ),
  }
}
